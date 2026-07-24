type CanonicalAccountPrompt = {
  id: string;
  code: string;
  name: string;
  statementType: string;
  aliases: unknown;
};

type AiChunk = {
  section: string;
  chunkType: "SECTION" | "TABLE" | "PAGE" | "TOKEN_BLOCK";
  pageStart: number | null;
  pageEnd: number | null;
  textSummary: string;
};

type AiCandidate = {
  statementType: "INCOME_STATEMENT" | "BALANCE_SHEET" | "CASH_FLOW" | "OTHER" | null;
  reportedLabel: string;
  rawValue: string;
  numericValue: number | null;
  currency: string | null;
  scale: number;
  sourcePage: number | null;
  sourceText: string | null;
  canonicalCode: string | null;
  extractionConfidence: number;
  mappingConfidence: number;
};

export type AiFinancialExtraction = {
  detectedYear: number | null;
  detectedPeriodType: "Q1" | "H1" | "Q3" | "FY" | "MONTHLY" | null;
  detectedCurrency: string | null;
  detectedUnitScale: number | null;
  pageCount: number | null;
  chunks: AiChunk[];
  candidates: AiCandidate[];
};

function outputText(response: any): string {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content?.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI tidak mengembalikan output teks yang dapat dibaca.");
}

export async function extractFinancialPdfWithOpenAI(params: {
  bytes: Buffer;
  fileName: string;
  companyTicker: string;
  companyName: string;
  expectedYear: number | null;
  expectedPeriodType: string | null;
  accounts: CanonicalAccountPrompt[];
}): Promise<AiFinancialExtraction> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY belum dikonfigurasi di Railway Variables.");

  const model = process.env.OPENAI_FINANCIAL_MODEL || "gpt-5";
  const accountDictionary = params.accounts.map((a) => ({
    code: a.code,
    name: a.name,
    statementType: a.statementType,
    aliases: a.aliases,
  }));

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["detectedYear", "detectedPeriodType", "detectedCurrency", "detectedUnitScale", "pageCount", "chunks", "candidates"],
    properties: {
      detectedYear: { anyOf: [{ type: "integer" }, { type: "null" }] },
      detectedPeriodType: { anyOf: [{ type: "string", enum: ["Q1", "H1", "Q3", "FY", "MONTHLY"] }, { type: "null" }] },
      detectedCurrency: { anyOf: [{ type: "string" }, { type: "null" }] },
      detectedUnitScale: { anyOf: [{ type: "integer" }, { type: "null" }] },
      pageCount: { anyOf: [{ type: "integer" }, { type: "null" }] },
      chunks: {
        type: "array",
        maxItems: 80,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["section", "chunkType", "pageStart", "pageEnd", "textSummary"],
          properties: {
            section: { type: "string" },
            chunkType: { type: "string", enum: ["SECTION", "TABLE", "PAGE", "TOKEN_BLOCK"] },
            pageStart: { anyOf: [{ type: "integer" }, { type: "null" }] },
            pageEnd: { anyOf: [{ type: "integer" }, { type: "null" }] },
            textSummary: { type: "string" },
          },
        },
      },
      candidates: {
        type: "array",
        maxItems: 250,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["statementType", "reportedLabel", "rawValue", "numericValue", "currency", "scale", "sourcePage", "sourceText", "canonicalCode", "extractionConfidence", "mappingConfidence"],
          properties: {
            statementType: { anyOf: [{ type: "string", enum: ["INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW", "OTHER"] }, { type: "null" }] },
            reportedLabel: { type: "string" },
            rawValue: { type: "string" },
            numericValue: { anyOf: [{ type: "number" }, { type: "null" }] },
            currency: { anyOf: [{ type: "string" }, { type: "null" }] },
            scale: { type: "integer" },
            sourcePage: { anyOf: [{ type: "integer" }, { type: "null" }] },
            sourceText: { anyOf: [{ type: "string" }, { type: "null" }] },
            canonicalCode: { anyOf: [{ type: "string" }, { type: "null" }] },
            extractionConfidence: { type: "number", minimum: 0, maximum: 1 },
            mappingConfidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  };

  const prompt = `You are the financial-statement extraction engine for InvestAI.\n\nCompany: ${params.companyTicker} — ${params.companyName}\nExpected period: ${params.expectedPeriodType ?? "unknown"} ${params.expectedYear ?? "unknown"}.\n\nTasks:\n1. Inspect the entire PDF, including visual tables.\n2. Identify the primary consolidated Income Statement, Balance Sheet / Statement of Financial Position, and Cash Flow Statement. Notes may be used as evidence, but do not substitute note detail for the primary statements unless necessary.\n3. Build structure-aware logical chunks by statement/section/table. Never split a financial table merely because it crosses pages.\n4. Extract financial line items and the value for the requested reporting period. Do not mix comparative prior-year values into the current-period candidate list.\n5. Normalize parentheses as negative values where appropriate. Preserve rawValue exactly enough for audit.\n6. Detect currency and unit scale (1, 1000, 1000000, 1000000000). numericValue must be the displayed number before scale multiplication; scale holds the multiplier.\n7. Map only when reasonably confident to one of the canonical account codes below. Otherwise canonicalCode must be null.\n8. sourcePage and sourceText are mandatory evidence when visible.\n9. Never invent a value. Missing/uncertain values should not be emitted.\n10. extractionConfidence measures reading confidence. mappingConfidence measures canonical mapping confidence.\n\nCanonical account dictionary:\n${JSON.stringify(accountDictionary)}\n\nReturn only the requested structured JSON.`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          {
            type: "input_file",
            filename: params.fileName,
            file_data: `data:application/pdf;base64,${params.bytes.toString("base64")}`,
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "financial_statement_extraction",
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload?.error?.message || `OpenAI request gagal (${response.status}).`;
    throw new Error(detail);
  }

  const parsed = JSON.parse(outputText(payload)) as AiFinancialExtraction;
  if (!Array.isArray(parsed.candidates) || !Array.isArray(parsed.chunks)) throw new Error("Format hasil AI tidak valid.");
  return parsed;
}
