import { z } from "zod";

const nullableInteger = z.number().int().nullable();
const confidence = z.number().min(0).max(1);
const statementType = z.enum(["INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW", "OTHER"]);

const chunkSchema = z.object({
  section: z.string().min(1).max(500),
  chunkType: z.enum(["SECTION", "TABLE", "PAGE", "TOKEN_BLOCK"]),
  pageStart: nullableInteger,
  pageEnd: nullableInteger,
  textSummary: z.string().min(1).max(12_000),
}).superRefine((chunk, context) => {
  if ((chunk.pageStart === null) !== (chunk.pageEnd === null)) context.addIssue({ code: "custom", message: "pageStart and pageEnd must both be present or null" });
  if (chunk.pageStart !== null && chunk.pageStart < 1) context.addIssue({ code: "custom", message: "pageStart must be positive" });
  if (chunk.pageEnd !== null && chunk.pageStart !== null && chunk.pageEnd < chunk.pageStart) context.addIssue({ code: "custom", message: "pageEnd must not precede pageStart" });
});

const candidateSchema = z.object({
  statementType: statementType.nullable(),
  reportedLabel: z.string().min(1).max(500),
  rawValue: z.string().min(1).max(250),
  numericValue: z.number().finite().nullable(),
  currency: z.string().trim().min(3).max(12).nullable(),
  scale: z.number().int().positive().max(1_000_000_000_000),
  sourcePage: nullableInteger,
  sourceText: z.string().min(1).max(2_000).nullable(),
  canonicalCode: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(),
  extractionConfidence: confidence,
  mappingConfidence: confidence,
}).superRefine((candidate, context) => {
  if (candidate.sourcePage !== null && candidate.sourcePage < 1) context.addIssue({ code: "custom", message: "sourcePage must be positive" });
  if (candidate.numericValue !== null && (candidate.sourcePage === null || candidate.sourceText === null)) context.addIssue({ code: "custom", message: "numeric candidates require page and source text" });
});

export const financialExtractionSchema = z.object({
  detectedCompanyTicker: z.string().trim().min(1).max(20).nullable(),
  detectedCompanyName: z.string().trim().min(2).max(250).nullable(),
  detectedCompanyConfidence: confidence,
  detectedYear: z.number().int().min(1990).max(2100).nullable(),
  detectedPeriodType: z.enum(["Q1", "H1", "Q3", "FY", "MONTHLY"]).nullable(),
  detectedPeriodConfidence: confidence,
  detectedCurrency: z.string().trim().min(3).max(12).nullable(),
  detectedUnitScale: z.number().int().positive().max(1_000_000_000_000).nullable(),
  pageCount: z.number().int().positive().max(20_000).nullable(),
  chunks: z.array(chunkSchema).min(1).max(80),
  candidates: z.array(candidateSchema).max(250),
}).superRefine((result, context) => {
  if (result.detectedCompanyConfidence >= 0.95 && (!result.detectedCompanyTicker || !result.detectedCompanyName)) context.addIssue({ code: "custom", message: "High-confidence company detection requires ticker and name" });
  if (result.detectedPeriodConfidence >= 0.75 && (!result.detectedYear || !result.detectedPeriodType)) context.addIssue({ code: "custom", message: "High-confidence period detection requires year and period" });
  if (result.pageCount && result.candidates.some((candidate) => candidate.sourcePage !== null && candidate.sourcePage > result.pageCount!)) context.addIssue({ code: "custom", message: "Candidate sourcePage exceeds pageCount" });
});

export type ValidatedFinancialExtraction = z.infer<typeof financialExtractionSchema>;
