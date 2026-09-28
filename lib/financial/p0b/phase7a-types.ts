import type { P0AEvidence, P0AIssuerContext, P0APageSourceType } from "@/lib/financial/p0a/types";

export type Phase7APresentationRole = "CURRENT_PERIOD" | "COMPARATIVE_PERIOD" | "CURRENT_PERIOD_END" | "PRIOR_YEAR_END";
export type Phase7APeriodNature = "INSTANT" | "DURATION";

export type Phase7AReportedFact = {
  temporalIdentityKey: string;
  assertionKey: string;
  requirementId: string;
  family: "P0A_REPORTED" | "PHASE6A_REPORTED";
  state: "VALUE" | "ZERO";
  decimalValue: string;
  rawValue: string;
  currency: string;
  unitType: string;
  scale: string;
  period: { start: string; end: string; type: P0AIssuerContext["periodType"]; nature: Phase7APeriodNature };
  consolidationScope: "CONSOLIDATED" | "STANDALONE" | "UNKNOWN";
  presentationRole: Phase7APresentationRole;
  presentationMetadata: { periodColumnLabel: string; restatementMarker: string | null };
  sourceRevisionHash: string;
  extractionOrigin: P0APageSourceType;
  confidence: { read: number; mapping: number };
  evidence: P0AEvidence[];
};

export type Phase7ADerivedFact = {
  resultHash: string;
  canonicalCode: string;
  formulaVersion: string;
  expression: string;
  state: "VALUE" | "ZERO" | "INPUT_PERIOD_MISMATCH";
  value: string | null;
  currency: string;
  unitType: string;
  scale: string;
  period: { start: string; end: string; type: P0AIssuerContext["periodType"]; nature: Phase7APeriodNature };
  consolidationScope: "CONSOLIDATED" | "STANDALONE" | "UNKNOWN";
  presentationRole: Phase7APresentationRole;
  sourceRevisionHash: string;
  inputs: Array<{ inputIdentity: string; inputRole: string; requirementId: string; value: string; periodStart: string; periodEnd: string; currency: string; scale: string; scope: string }>;
};

export type Phase7ASegmentFact = {
  factKey: string;
  continuityKey: string;
  normalizedLabel: string;
  sourceLabel: string;
  segmentType: "BUSINESS" | "RECONCILIATION";
  metricCode: "REVENUE" | "OPERATING_PROFIT";
  metricLabel: string;
  sourceMetricLabel: string;
  salesScope: "EXTERNAL" | "INTERSEGMENT" | "TOTAL" | null;
  reportedValue: string;
  normalizedValue: string;
  rawValue: string;
  currency: string;
  scale: string;
  period: { start: string; end: string; type: P0AIssuerContext["periodType"]; nature: "DURATION" };
  consolidationScope: "CONSOLIDATED" | "STANDALONE" | "UNKNOWN";
  presentationRole: "COMPARATIVE_PERIOD";
  presentationMetadata: { periodColumnLabel: string; restatementMarker: string | null };
  sourceRevisionHash: string;
  extractionOrigin: P0APageSourceType;
  evidence: P0AEvidence[];
};

export type Phase7ADividendDedup = {
  economicEventKey: string;
  canonicalEventKey: string;
  evidenceOccurrences: number;
  distinctEvidencePages: number[];
  duplicateCanonicalEvents: number;
  passed: boolean;
};

export type Phase7AValidation = {
  controlId: string;
  passed: boolean;
  state: "PASS" | "INPUT_PERIOD_MISMATCH" | "CONFLICT";
  reason: string;
};

export type Phase7AResult = {
  manifestVersion: string;
  extractorVersion: string;
  context: P0AIssuerContext;
  documentSha256: string;
  currentPeriod: { start: string; end: string; type: P0AIssuerContext["periodType"] };
  comparativePeriods: Array<{ start: string; end: string; type: P0AIssuerContext["periodType"]; role: Phase7APresentationRole }>;
  reportedFacts: Phase7AReportedFact[];
  derivedFacts: Phase7ADerivedFact[];
  segmentFacts: Phase7ASegmentFact[];
  dividendDedup: Phase7ADividendDedup[];
  validations: Phase7AValidation[];
  temporalConflicts: string[];
  selectedPages: number[];
  p0a: { currentOutcomeFingerprint: string; ocrPages: number[]; reusedOcrPages: number[]; versions: Record<string,string> };
  phase6a: { currentRunIdentity: string; outcomeFingerprint: string };
  phase6b: { currentRunIdentity: string; eventCount: number; segmentFactCount: number };
  providerUsage: { providerCalls: 0; inputTokens: 0; outputTokens: 0; costUsd: "0.00000000" };
  runIdentity: string;
};
