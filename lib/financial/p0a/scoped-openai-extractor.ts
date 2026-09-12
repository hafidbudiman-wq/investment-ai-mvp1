import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { P0A_REQUIREMENT_BY_ID } from "@/lib/financial/p0a/requirements";
import type { P0AIndexedPage, P0AIssuerContext, P0AProviderAttemptUsage, P0AValueState } from "@/lib/financial/p0a/types";
import { P0A_VERSION_SET } from "@/lib/financial/p0a/versions";

export const PHASE3_PROVIDER_SUBMISSION_LIMIT = 2;
export const PHASE3_DEFAULT_MAX_OUTPUT_TOKENS = 4_000;

export type ScopedInputMode = "NATIVE_LAYOUT_TEXT" | "PAGE_MARKED_TEXT" | "VISUAL_PAGE";

export type ScopedPageInput = Pick<P0AIndexedPage, "pageNumber" | "printedPageLabel" | "width" | "height" | "text" | "textHash" | "layoutHash" | "tokens"> & {
  visualDataUrl?: string;
};

export type ScopedExtractionInput = {
  document: { sha256: string; pageCount: number; fileName: string };
  context: P0AIssuerContext;
  unresolvedRequirementIds: string[];
  pages: ScopedPageInput[];
  inputMode: ScopedInputMode;
};

export type ScopedProviderResultFact = {
  requirementId: string;
  state: P0AValueState | "NEEDS_REVIEW";
  rawLabel: string | null;
  rawValue: string | null;
  decimalValue: string | null;
  currency: string | null;
  unit: string | null;
  scale: string | null;
  periodEnd: string | null;
  consolidationScope: "CONSOLIDATED" | "STANDALONE" | "UNKNOWN";
  pageNumber: number | null;
  sourceSnippet: string | null;
  rationale: string;
};

export type ScopedProviderResponse = {
  providerRequestId: string | null;
  providerResponseId: string | null;
  outputText: string;
  inputTokens: number | null;
  outputTokens: number | null;
  billedCostUsd: string | null;
};

export interface ScopedProviderTransport {
  submit(input: { body: Record<string, unknown>; idempotencyKey: string }): Promise<ScopedProviderResponse>;
}

export type ScopedValidatedCacheEntry = {
  cacheKey: string;
  validated: true;
  facts: ScopedProviderResultFact[];
  outputHash: string;
};

export interface ScopedProviderCache {
  getValidated(cacheKey: string): Promise<ScopedValidatedCacheEntry | null>;
  putValidated(entry: ScopedValidatedCacheEntry): Promise<void>;
}

export class InMemoryScopedProviderCache implements ScopedProviderCache {
  private readonly entries = new Map<string, ScopedValidatedCacheEntry>();
  async getValidated(cacheKey: string): Promise<ScopedValidatedCacheEntry | null> { return this.entries.get(cacheKey) ?? null; }
  async putValidated(entry: ScopedValidatedCacheEntry): Promise<void> { this.entries.set(entry.cacheKey, entry); }
}

export class ScopedSubmissionUnknownError extends Error {
  constructor(
    message: string,
    readonly providerRequestId: string | null,
    readonly providerResponseId: string | null,
    readonly usage?: P0AProviderAttemptUsage,
  ) { super(message); this.name = "ScopedSubmissionUnknownError"; }
}

export type Phase3ExecutionGuard = {
  explicitlyApproved: boolean;
  shadowDatabaseName: string;
  canonicalWriteEnabled: false;
};

const factSchema = z.object({
  requirementId: z.string().min(1),
  state: z.enum(["VALUE", "ZERO", "MISSING", "NOT_APPLICABLE", "NOT_DISCLOSED", "AMBIGUOUS", "CONFLICT", "NEEDS_REVIEW"]),
  rawLabel: z.string().nullable(), rawValue: z.string().nullable(), decimalValue: z.string().nullable(),
  currency: z.string().nullable(), unit: z.string().nullable(), scale: z.string().nullable(), periodEnd: z.string().nullable(),
  consolidationScope: z.enum(["CONSOLIDATED", "STANDALONE", "UNKNOWN"]),
  pageNumber: z.number().int().positive().nullable(), sourceSnippet: z.string().nullable(), rationale: z.string().min(1),
}).strict();
const outputSchema = z.object({ facts: z.array(factSchema) }).strict();

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function scopedProviderCacheKey(input: ScopedExtractionInput, provider: string, model: string): string {
  return hash(stable({
    documentSha: input.document.sha256,
    selectedPages: [...new Set(input.pages.map((page) => page.pageNumber))].sort((a, b) => a - b),
    requirements: [...new Set(input.unresolvedRequirementIds)].sort(),
    contractVersion: P0A_VERSION_SET.contract,
    parserVersion: P0A_VERSION_SET.parser,
    routerVersion: P0A_VERSION_SET.router,
    plannerVersion: P0A_VERSION_SET.planner,
    mappingVersion: P0A_VERSION_SET.mapping,
    promptVersion: P0A_VERSION_SET.scopedPrompt,
    provider,
    model,
    inputMode: input.inputMode,
    pageHashes: input.pages.map((page) => ({ page: page.pageNumber, textHash: page.textHash, layoutHash: page.layoutHash })),
  }));
}

function assertScopedInput(input: ScopedExtractionInput): void {
  if (!/^[a-f0-9]{64}$/i.test(input.document.sha256)) throw new Error("Scoped provider input requires a verified document SHA-256.");
  if (!input.unresolvedRequirementIds.length) throw new Error("Scoped provider input has no unresolved requirements.");
  if (!input.pages.length) throw new Error("Scoped provider input has no selected pages.");
  const unknown = input.unresolvedRequirementIds.filter((id) => !P0A_REQUIREMENT_BY_ID.has(id));
  if (unknown.length) throw new Error(`Scoped provider input contains unknown frozen requirements: ${unknown.join(", ")}`);
  if (input.pages.some((page) => page.pageNumber < 1 || page.pageNumber > input.document.pageCount)) throw new Error("Scoped provider page is outside the verified document page range.");
  if (new Set(input.pages.map((page) => page.pageNumber)).size !== input.pages.length) throw new Error("Scoped provider pages must be unique.");
  if (input.inputMode === "VISUAL_PAGE" && input.pages.some((page) => !page.visualDataUrl?.startsWith("data:image/"))) {
    throw new Error("Visual scoped input requires a page image for every selected page; PDF/full-document bytes are not accepted.");
  }
}

function requirementContract(ids: readonly string[]): string {
  return ids.map((id) => {
    const requirement = P0A_REQUIREMENT_BY_ID.get(id)!;
    return `${id}: ${requirement.definition} Unit=${requirement.unitType}; periodNature=${requirement.periodNature}.`;
  }).join("\n");
}

export function buildScopedOpenAIRequest(input: ScopedExtractionInput, model: string, maxOutputTokens = PHASE3_DEFAULT_MAX_OUTPUT_TOKENS): Record<string, unknown> {
  assertScopedInput(input);
  const allowedPages = new Set(input.pages.map((page) => page.pageNumber));
  const markedText = input.pages.map((page) => [
    `--- ORIGINAL PDF PAGE ${page.pageNumber}${page.printedPageLabel ? ` / PRINTED PAGE ${page.printedPageLabel}` : ""} ---`,
    page.text,
    input.inputMode === "NATIVE_LAYOUT_TEXT" ? `LAYOUT_TOKENS=${JSON.stringify(page.tokens)}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");

  const instructions = [
    "You are a scoped financial-statement evidence resolver.",
    `Determine ONLY these unresolved IDs: ${input.unresolvedRequirementIds.join(", ")}.`,
    "Do not inspect or request the full document. Use only the exact pages supplied below.",
    "Do not calculate unrelated ratios, perform investment analysis, infer sector KPIs, change applicability, or alter canonical definitions.",
    "Never invent missing digits. If exact row, column, period, unit, scale, or scope cannot be evidenced, return AMBIGUOUS or NEEDS_REVIEW.",
    "A calculated component sum must not be returned as a REPORTED scalar. If no direct scalar is disclosed, return NOT_DISCLOSED.",
    `Reporting period: ${input.context.periodStart} to ${input.context.periodEnd} (${input.context.periodType}). Expected currency=${input.context.currency}; document scale=${input.context.documentScale}.`,
    `Canonical contract ${P0A_VERSION_SET.contract}:`,
    requirementContract(input.unresolvedRequirementIds),
    "Every VALUE/ZERO must quote a source snippet and identify an allowed original PDF page.",
    `Allowed original PDF pages: ${[...allowedPages].sort((a, b) => a - b).join(", ")}.`,
  ].join("\n");

  const textContent = { type: "input_text", text: markedText };
  const visualContent = input.inputMode === "VISUAL_PAGE"
    ? input.pages.flatMap((page) => [{ type: "input_text", text: `ORIGINAL PDF PAGE ${page.pageNumber}` }, { type: "input_image", image_url: page.visualDataUrl }])
    : [textContent];

  return {
    model,
    max_output_tokens: maxOutputTokens,
    store: false,
    input: [{ role: "system", content: [{ type: "input_text", text: instructions }] }, { role: "user", content: visualContent }],
    text: {
      format: {
        type: "json_schema",
        name: "investai_scoped_financial_facts",
        strict: true,
        schema: {
          type: "object", additionalProperties: false, required: ["facts"],
          properties: { facts: { type: "array", items: {
            type: "object", additionalProperties: false,
            required: ["requirementId", "state", "rawLabel", "rawValue", "decimalValue", "currency", "unit", "scale", "periodEnd", "consolidationScope", "pageNumber", "sourceSnippet", "rationale"],
            properties: {
              requirementId: { type: "string", enum: input.unresolvedRequirementIds },
              state: { type: "string", enum: ["VALUE", "ZERO", "MISSING", "NOT_APPLICABLE", "NOT_DISCLOSED", "AMBIGUOUS", "CONFLICT", "NEEDS_REVIEW"] },
              rawLabel: { type: ["string", "null"] }, rawValue: { type: ["string", "null"] }, decimalValue: { type: ["string", "null"] },
              currency: { type: ["string", "null"] }, unit: { type: ["string", "null"] }, scale: { type: ["string", "null"] }, periodEnd: { type: ["string", "null"] },
              consolidationScope: { type: "string", enum: ["CONSOLIDATED", "STANDALONE", "UNKNOWN"] },
              pageNumber: { type: ["integer", "null"], enum: [...allowedPages, null] }, sourceSnippet: { type: ["string", "null"] }, rationale: { type: "string" },
            },
          } } },
        },
      },
    },
  };
}

export type ScopedExecutionResult = { facts: ScopedProviderResultFact[]; usage: P0AProviderAttemptUsage; cacheKey: string };

export class ScopedOpenAIExtractor {
  private providerSubmissions = 0;
  constructor(
    private readonly model: string,
    private readonly transport: ScopedProviderTransport,
    private readonly cache: ScopedProviderCache,
    private readonly maxOutputTokens = PHASE3_DEFAULT_MAX_OUTPUT_TOKENS,
  ) {}

  plannedSubmissionCount(): number { return this.providerSubmissions; }

  async execute(input: ScopedExtractionInput, guard: Phase3ExecutionGuard): Promise<ScopedExecutionResult> {
    assertScopedInput(input);
    const cacheKey = scopedProviderCacheKey(input, "openai", this.model);
    const cached = await this.cache.getValidated(cacheKey);
    if (cached) {
      return { facts: cached.facts, cacheKey, usage: {
        provider: "openai", model: this.model, selectedPageCount: input.pages.length, requirementCount: input.unresolvedRequirementIds.length,
        providerRequestId: null, providerResponseId: null, retryCount: 0, inputTokens: 0, outputTokens: 0,
        processingLatencyMs: 0, estimatedCostUsd: "0", billedCostUsd: "0", providerCalls: 0,
        attemptNumber: 0, inputHash: cacheKey, outputHash: cached.outputHash, status: "CACHE_HIT",
      } };
    }
    if (!guard.explicitlyApproved) throw new Error("CONTROLLED_API_APPROVAL_REQUIRED: real provider execution has not been explicitly approved.");
    if (guard.canonicalWriteEnabled !== false) throw new Error("Phase 3 forbids canonical writes.");
    if (!/(?:p0a_shadow|phase3|test)/i.test(guard.shadowDatabaseName)) throw new Error("Phase 3 provider execution requires an isolated shadow/test database.");
    if (this.providerSubmissions >= PHASE3_PROVIDER_SUBMISSION_LIMIT) throw new Error("PHASE3_PROVIDER_CALL_CEILING_REACHED");

    const body = buildScopedOpenAIRequest(input, this.model, this.maxOutputTokens);
    const started = Date.now();
    const attemptNumber = ++this.providerSubmissions;
    const idempotencyKey = `investai-p0a-${cacheKey}`;
    let response: ScopedProviderResponse;
    try {
      response = await this.transport.submit({ body, idempotencyKey });
    } catch (error) {
      const providerRequestId = error instanceof ScopedSubmissionUnknownError ? error.providerRequestId : null;
      const providerResponseId = error instanceof ScopedSubmissionUnknownError ? error.providerResponseId : null;
      const usage: P0AProviderAttemptUsage = {
        provider: "openai", model: this.model, selectedPageCount: input.pages.length, requirementCount: input.unresolvedRequirementIds.length,
        providerRequestId, providerResponseId, retryCount: 0, inputTokens: null, outputTokens: null,
        processingLatencyMs: Date.now() - started, estimatedCostUsd: null, billedCostUsd: null, providerCalls: 1,
        attemptNumber, inputHash: cacheKey, outputHash: null, status: "SUBMISSION_UNKNOWN",
      };
      throw new ScopedSubmissionUnknownError(
        `Provider submission outcome is unknown; reconcile before any resend. ${error instanceof Error ? error.message : String(error)}`,
        providerRequestId,
        providerResponseId,
        usage,
      );
    }

    const parsed = outputSchema.parse(JSON.parse(response.outputText));
    const expected = new Set(input.unresolvedRequirementIds);
    if (parsed.facts.some((fact) => !expected.has(fact.requirementId))) throw new Error("Provider returned an out-of-scope requirement.");
    const pages = new Set(input.pages.map((page) => page.pageNumber));
    if (parsed.facts.some((fact) => fact.pageNumber !== null && !pages.has(fact.pageNumber))) throw new Error("Provider returned evidence from an unsupplied page.");
    const outputHash = hash(stable(parsed));
    await this.cache.putValidated({ cacheKey, validated: true, facts: parsed.facts, outputHash });
    return { facts: parsed.facts, cacheKey, usage: {
      provider: "openai", model: this.model, selectedPageCount: input.pages.length, requirementCount: input.unresolvedRequirementIds.length,
      providerRequestId: response.providerRequestId, providerResponseId: response.providerResponseId, retryCount: 0,
      inputTokens: response.inputTokens, outputTokens: response.outputTokens, processingLatencyMs: Date.now() - started,
      estimatedCostUsd: null, billedCostUsd: response.billedCostUsd, providerCalls: 1,
      attemptNumber, inputHash: cacheKey, outputHash, status: "SUCCEEDED",
    } };
  }
}

/** Real transport exists for the approval-gated path; constructing it makes no API call. */
export function createOpenAIResponsesTransport(apiKey: string): ScopedProviderTransport {
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to construct the scoped provider transport.");
  return {
    async submit({ body, idempotencyKey }) {
      const clientRequestId = randomUUID();
      let response: Response;
      try {
        response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey, "X-Client-Request-Id": clientRequestId },
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new ScopedSubmissionUnknownError(error instanceof Error ? error.message : String(error), clientRequestId, null);
      }
      const providerRequestId = response.headers.get("x-request-id") ?? clientRequestId;
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(`Scoped OpenAI request failed (${response.status}) request=${providerRequestId}.`);
      const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
      const outputText = output.flatMap((item) => Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : []).map((item) => typeof item.text === "string" ? item.text : "").join("");
      const usage = payload.usage as Record<string, unknown> | undefined;
      return {
        providerRequestId,
        providerResponseId: typeof payload.id === "string" ? payload.id : null,
        outputText,
        inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : null,
        outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : null,
        billedCostUsd: null,
      };
    },
  };
}
