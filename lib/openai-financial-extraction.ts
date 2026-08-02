import type { PdfPreflight } from "@/lib/pdf-extraction";
import { financialExtractionSchema, type ValidatedFinancialExtraction } from "@/lib/financial/extraction-schema";

type CanonicalAccountPrompt = { id: string; code: string; name: string; statementType: string; aliases: unknown };
type KnownCompanyPrompt = { ticker: string; name: string };
export type AiFinancialExtraction = ValidatedFinancialExtraction;

export type BackgroundResponse = {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "cancelled" | "incomplete";
  output_text?: string;
  output?: unknown[];
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
};

// Keep PDF input + structured output below the organization's TPM ceiling.
// The 13 critical InvestAI accounts fit comfortably in this output budget.
export const FINANCIAL_EXTRACTION_MAX_OUTPUT_TOKENS = 4_000;

function apiKey() {
  const value = process.env.OPENAI_API_KEY;
  if (!value) throw new Error("OPENAI_API_KEY belum dikonfigurasi di Railway Variables.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function outputText(response: BackgroundResponse): string {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of response.output ?? []) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI tidak mengembalikan output teks yang dapat dibaca.");
}

function requestBody(params: { bytes: Buffer; fileName: string; knownCompanies: KnownCompanyPrompt[]; accounts: CanonicalAccountPrompt[]; preflight: PdfPreflight }, background: boolean) {
  const model = process.env.OPENAI_FINANCIAL_MODEL || "gpt-5.6";
  const accountDictionary = params.accounts.map((a) => ({ code: a.code, name: a.name, statementType: a.statementType, aliases: a.aliases }));
  const companyDictionary = params.knownCompanies.map((company) => ({ ticker: company.ticker, name: company.name }));
  const schema = { type: "object", additionalProperties: false, required: ["detectedCompanyTicker","detectedCompanyName","detectedCompanyConfidence","detectedYear","detectedPeriodType","detectedPeriodConfidence","detectedCurrency","detectedUnitScale","pageCount","chunks","candidates"], properties: { detectedCompanyTicker:{anyOf:[{type:"string"},{type:"null"}]}, detectedCompanyName:{anyOf:[{type:"string"},{type:"null"}]}, detectedCompanyConfidence:{type:"number",minimum:0,maximum:1}, detectedYear:{anyOf:[{type:"integer"},{type:"null"}]}, detectedPeriodType:{anyOf:[{type:"string",enum:["Q1","H1","Q3","FY","MONTHLY"]},{type:"null"}]}, detectedPeriodConfidence:{type:"number",minimum:0,maximum:1}, detectedCurrency:{anyOf:[{type:"string"},{type:"null"}]}, detectedUnitScale:{anyOf:[{type:"integer"},{type:"null"}]}, pageCount:{anyOf:[{type:"integer"},{type:"null"}]}, chunks:{type:"array",maxItems:80,items:{type:"object",additionalProperties:false,required:["section","chunkType","pageStart","pageEnd","textSummary"],properties:{section:{type:"string"},chunkType:{type:"string",enum:["SECTION","TABLE","PAGE","TOKEN_BLOCK"]},pageStart:{anyOf:[{type:"integer"},{type:"null"}]},pageEnd:{anyOf:[{type:"integer"},{type:"null"}]},textSummary:{type:"string"}}}}, candidates:{type:"array",maxItems:250,items:{type:"object",additionalProperties:false,required:["statementType","reportedLabel","rawValue","numericValue","currency","scale","sourcePage","sourceText","canonicalCode","extractionConfidence","mappingConfidence"],properties:{statementType:{anyOf:[{type:"string",enum:["INCOME_STATEMENT","BALANCE_SHEET","CASH_FLOW","OTHER"]},{type:"null"}]},reportedLabel:{type:"string"},rawValue:{type:"string"},numericValue:{anyOf:[{type:"number"},{type:"null"}]},currency:{anyOf:[{type:"string"},{type:"null"}]},scale:{type:"integer"},sourcePage:{anyOf:[{type:"integer"},{type:"null"}]},sourceText:{anyOf:[{type:"string"},{type:"null"}]},canonicalCode:{anyOf:[{type:"string"},{type:"null"}]},extractionConfidence:{type:"number",minimum:0,maximum:1},mappingConfidence:{type:"number",minimum:0,maximum:1}}}} } };
  const modeInstruction = params.preflight.processingMode === "VISION_OCR_FALLBACK"
    ? "Preflight indicates a scanned/image PDF. Perform visual/OCR reading page by page. Do not assume selectable text exists."
    : params.preflight.processingMode === "HYBRID"
      ? "Preflight indicates a hybrid PDF. Reconcile native text with visual/OCR reading, especially tables and pages whose text layer is incomplete."
      : "Preflight indicates native text. Prefer the embedded text layer but visually verify financial tables, column alignment, signs and units.";
  const prompt = `You are the financial-statement extraction engine for InvestAI.\nThe user only uploads the financial-statement PDF. You must detect the issuer/company and the primary reporting period from the document itself.\nPreflight mode: ${params.preflight.processingMode}. ${modeInstruction}\n\nPipeline rules:\n1. Inspect the entire PDF before extracting values. OCR/vision is a fallback or verification layer, not a reason to discard good native text.\n2. Detect the REPORTING ENTITY from the document title/header and legal issuer identity. Do NOT mistake subsidiaries, customers, suppliers, or related parties mentioned in notes for the reporting company. Return detectedCompanyTicker, detectedCompanyName and detectedCompanyConfidence. Prefer an exact match from the known-company dictionary when supported by the document.\n3. Detect the current/primary reporting period and year from the statement headings. Comparative prior-period columns are evidence only and must never become the detected reporting period. Return detectedPeriodConfidence.\n4. Detect document structure: primary consolidated Balance Sheet / Statement of Financial Position, Income Statement, Cash Flow Statement, then relevant notes.\n5. Build structure-aware chunks by statement, section and table. A table spanning pages is ONE logical TABLE chunk; do not create arbitrary page/token chunks unless structure cannot be recovered.\n6. Extract the CURRENT reporting-period column only. Never mix comparative prior-period values.\n7. Preserve labels, raw values, signs/parentheses, currency and displayed unit. numericValue is before scale multiplication. Parentheses representing negatives must become negative numericValue.\n8. sourcePage and sourceText must identify evidence. If OCR is uncertain, lower extractionConfidence; never invent digits.\n9. Suggest a canonicalCode only from the dictionary and only when semantically supported; otherwise null. mappingConfidence is separate from reading confidence.\n10. Prefer primary-statement totals for canonical metrics. Notes can support evidence/detail but must not silently replace a primary-statement total.\n11. Return chunks in document order and candidates tied conceptually to those chunks.\n\nKnown company dictionary:\n${JSON.stringify(companyDictionary)}\n\nCanonical account dictionary:\n${JSON.stringify(accountDictionary)}\n\nReturn only the requested structured JSON.`;
  const boundedPrompt = `${prompt}\n\nOutput budget rules:\n- Extract only accounts in the canonical dictionary plus components strictly required for their aggregation.\n- Return at most 40 candidates.\n- Keep chunk summaries concise and evidence-focused.\n- Do not spend output tokens describing unrelated note disclosures.`;
  return { model, background, store: true, max_output_tokens: FINANCIAL_EXTRACTION_MAX_OUTPUT_TOKENS, input:[{role:"user",content:[{type:"input_text",text:boundedPrompt},{type:"input_file",filename:params.fileName,file_data:`data:application/pdf;base64,${params.bytes.toString("base64")}`}]}], text:{format:{type:"json_schema",name:"financial_statement_extraction",strict:true,schema}} };
}

async function openAiFetch(path: string, init?: RequestInit) {
  const response = await fetch(`https://api.openai.com/v1${path}`, { ...init, headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI request gagal (${response.status}).`);
  return payload;
}

export async function submitFinancialPdfBackground(params: { bytes: Buffer; fileName: string; knownCompanies: KnownCompanyPrompt[]; accounts: CanonicalAccountPrompt[]; preflight: PdfPreflight }) {
  const payload = await openAiFetch("/responses", { method: "POST", body: JSON.stringify(requestBody(params, true)) }) as BackgroundResponse;
  if (!payload.id) throw new Error("OpenAI tidak mengembalikan response id untuk background job.");
  return payload;
}

export async function retrieveFinancialPdfBackground(responseId: string) {
  return await openAiFetch(`/responses/${encodeURIComponent(responseId)}`, { method: "GET" }) as BackgroundResponse;
}

export function parseFinancialExtractionResponse(response: BackgroundResponse): AiFinancialExtraction {
  return financialExtractionSchema.parse(JSON.parse(outputText(response)));
}

export async function extractFinancialPdfWithOpenAI(params: { bytes: Buffer; fileName: string; knownCompanies: KnownCompanyPrompt[]; accounts: CanonicalAccountPrompt[]; preflight: PdfPreflight }): Promise<AiFinancialExtraction> {
  const payload = await openAiFetch("/responses", { method: "POST", body: JSON.stringify(requestBody(params, false)) }) as BackgroundResponse;
  return parseFinancialExtractionResponse(payload);
}
