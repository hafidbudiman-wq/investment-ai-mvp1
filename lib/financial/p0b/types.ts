import type { P0AEvidence, P0AIssuerContext, P0APageSourceType, P0AValueState } from "@/lib/financial/p0a/types";

export type Phase6AFamily = "REPORTED" | "CALCULATED";
export type Phase6ACalculationState = "VALUE" | "ZERO" | "NOT_CALCULABLE" | "INPUT_MISSING" | "INPUT_SCOPE_CONFLICT";
export type Phase6AState = P0AValueState | Phase6ACalculationState;

export type Phase6ARequirement = {
  requirementId: string;
  canonicalCode: string;
  family: Phase6AFamily;
  definition: string;
  applicability: "EXPECTED" | "OPTIONAL";
  unitType: "DOCUMENT_CURRENCY" | "SHARES";
  periodNature: "INSTANT" | "DURATION";
};

export type Phase6AInput = {
  inputId: string;
  inputRole: string;
  requirementId: string;
  value: string;
  currency: string;
  scale: string;
  periodStart: string;
  periodEnd: string;
  scope: "CONSOLIDATED" | "STANDALONE" | "UNKNOWN";
  extractionOrigin: P0APageSourceType | null;
  evidence: P0AEvidence[];
};

export type Phase6AOutcome = {
  requirementId: string;
  canonicalCode: string;
  family: Phase6AFamily;
  applicability: "EXPECTED" | "OPTIONAL";
  state: Phase6AState;
  value: string | null;
  rawValue: string | null;
  currency: string | null;
  unitType: string;
  scale: string | null;
  period: { start: string; end: string; type: P0AIssuerContext["periodType"] };
  scope: "CONSOLIDATED" | "STANDALONE" | "UNKNOWN";
  evidence: P0AEvidence[];
  extractionOrigin: P0APageSourceType | null;
  confidence: { read: number | null; mapping: number | null };
  formula: null | { formulaId: string; formulaVersion: string; expression: string; calculationRunIdentity: string; resultHash: string };
  inputs: Phase6AInput[];
  reason: string;
  factIdentity: string | null;
};

export type Phase6AResult = {
  manifestVersion: string;
  extractorVersion: string;
  formulaRegistryVersion: string;
  context: P0AIssuerContext;
  documentSha256: string;
  p0a: { selectedPages: number[]; outcomeFingerprint: string; providerCalls: number; ocrPages: number[]; reusedOcrPages: number[]; versions: Record<string, string> };
  selectedPages: number[];
  outcomes: Phase6AOutcome[];
  controls: Array<{ controlId: string; applicable: boolean; passed: boolean | null; reason: string }>;
  providerUsage: { providerCalls: 0; inputTokens: 0; outputTokens: 0; costUsd: "0.00000000" };
  runIdentity: string;
};
