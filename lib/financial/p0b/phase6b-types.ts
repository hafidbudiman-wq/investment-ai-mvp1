import type { P0ACompatiblePipelineResult } from "@/lib/financial/p0a/pipeline";
import type { P0AEvidence, P0AIssuerContext, P0APageSourceType, P0AValueState } from "@/lib/financial/p0a/types";

export type Phase6BRequirementId = "DIVIDEND_EVENT" | "SEGMENT_REVENUE" | "SEGMENT_OPERATING_PROFIT";
export type Phase6BEventFieldState = "VALUE" | "FIELD_NOT_DISCLOSED";

export type Phase6BDividendEvent = {
  eventKey: string;
  eventType: "FINAL" | "INTERIM" | "SPECIAL" | "OTHER";
  status: "PROPOSED" | "DECLARED" | "APPROVED" | "PAID";
  sourceProfitPeriod: { start: string | null; end: string | null };
  dates: {
    declaration: string | null;
    approval: string | null;
    record: string | null;
    cum: string | null;
    ex: string | null;
    payment: string | null;
    paymentPrecision: "DAY" | "MONTH" | "PERIOD" | null;
    paymentRaw: string | null;
  };
  recipientScope: "PARENT_SHAREHOLDERS" | "NCI" | "OTHER";
  shareClass: string | null;
  total: null | {
    reportedValue: string;
    normalizedValue: string;
    rawValue: string;
    currency: string;
    scale: string;
  };
  perShare: null | {
    reportedValue: string;
    normalizedValue: string;
    rawValue: string;
    currency: string;
    scale: string;
  };
  fieldStates: Record<string, Phase6BEventFieldState>;
  evidence: Array<{ fieldName: string; evidence: P0AEvidence }>;
  extractionOrigin: P0APageSourceType;
  confidence: { read: number; mapping: number };
  validation: { status: "VALIDATED" | "RECONCILIATION_WARNING"; controls: string[] };
};

export type Phase6BSegmentIdentity = {
  identityKey: string;
  sourceLabel: string;
  normalizedLabel: string;
  segmentType: "BUSINESS" | "RECONCILIATION";
  validFrom: string;
  validTo: string;
  evidence: P0AEvidence[];
};

export type Phase6BSegmentFact = {
  factKey: string;
  segmentIdentityKey: string;
  metricCode: "REVENUE" | "OPERATING_PROFIT";
  metricLabel: string;
  sourceMetricLabel: string;
  periodColumn: string;
  salesScope: "EXTERNAL" | "INTERSEGMENT" | "TOTAL" | null;
  state: "VALUE" | "ZERO";
  reportedValue: string;
  normalizedValue: string;
  rawValue: string;
  currency: string;
  unitType: "DOCUMENT_CURRENCY";
  scale: string;
  period: { start: string; end: string; type: P0AIssuerContext["periodType"] };
  consolidationScope: "CONSOLIDATED" | "STANDALONE" | "UNKNOWN";
  dimensionHash: string;
  sourceDocumentSha256: string;
  extractionOrigin: P0APageSourceType;
  evidence: P0AEvidence[];
  confidence: { read: number; mapping: number };
  validationStatus: "VALIDATED";
};

export type Phase6BOutcome = {
  requirementId: Phase6BRequirementId;
  applicability: "EXPECTED" | "OPTIONAL";
  state: P0AValueState;
  factCount: number;
  attemptedPages: number[];
  reason: string;
};

export type Phase6BReconciliation = {
  controlId: string;
  applicable: boolean;
  passed: boolean | null;
  reportedValue: string | null;
  comparedValue: string | null;
  difference: string | null;
  reason: string;
};

export type Phase6BResult = {
  manifestVersion: string;
  extractorVersion: string;
  dimensionSchemaVersion: string;
  context: P0AIssuerContext;
  documentSha256: string;
  p0a: {
    outcomeFingerprint: string;
    ocrPages: number[];
    reusedOcrPages: number[];
    versions: Record<string, string>;
  };
  selectedPages: number[];
  dividendEvents: Phase6BDividendEvent[];
  segmentIdentities: Phase6BSegmentIdentity[];
  segmentFacts: Phase6BSegmentFact[];
  outcomes: Phase6BOutcome[];
  reconciliations: Phase6BReconciliation[];
  providerUsage: { providerCalls: 0; inputTokens: 0; outputTokens: 0; costUsd: "0.00000000" };
  runIdentity: string;
};

export type Phase6BPipelineInput = {
  bytes: Buffer;
  context: P0AIssuerContext;
  p0aResult?: P0ACompatiblePipelineResult;
};
