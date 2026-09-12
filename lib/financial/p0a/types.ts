export type P0AStatementType =
  | "BALANCE_SHEET"
  | "INCOME_STATEMENT"
  | "CHANGES_IN_EQUITY"
  | "CASH_FLOW"
  | "NOTE"
  | "OTHER";

export type P0APageClass =
  | "PRIMARY_BALANCE_SHEET"
  | "PRIMARY_INCOME_STATEMENT"
  | "PRIMARY_CHANGES_IN_EQUITY"
  | "PRIMARY_CASH_FLOW"
  | "TARGETED_NOTE"
  | "TABLE_OF_CONTENTS"
  | "AUDITOR_REPORT"
  | "OTHER";

export type P0ASourceRoute = "PRIMARY" | "NOTE" | "OFFICIAL_EXTERNAL";
export type P0AExpectation = "EXPECTED" | "OPTIONAL" | "NOT_APPLICABLE";
export type P0AValueState =
  | "VALUE"
  | "ZERO"
  | "MISSING"
  | "NOT_APPLICABLE"
  | "NOT_DISCLOSED"
  | "AMBIGUOUS"
  | "CONFLICT";
export type P0AFactOrigin = "REPORTED" | "STANDARDIZED_AGGREGATE";
export type P0AUnitType = "DOCUMENT_CURRENCY" | "PER_SHARE" | "SHARES";
export type P0APeriodNature = "INSTANT" | "DURATION";

export type P0APageToken = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lineBreak: boolean;
};

export type P0AIndexedPage = {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  normalizedText: string;
  textHash: string;
  layoutHash: string;
  printedPageLabel: string | null;
  tokens: P0APageToken[];
  extractionStatus: "NATIVE_TEXT" | "EMPTY";
};

export type P0ARoutedPage = P0AIndexedPage & {
  pageClass: P0APageClass;
  statementType: P0AStatementType;
  confidence: number;
  matchedAnchors: string[];
};

export type P0ARequirement = {
  id: string;
  legacyCode: string;
  definition: string;
  statementType: Exclude<P0AStatementType, "NOTE" | "OTHER">;
  expectation: P0AExpectation;
  unitType: P0AUnitType;
  periodNature: P0APeriodNature;
  routes: readonly P0ASourceRoute[];
  targetedAnchors: readonly string[];
};

export type P0AIssuerContext = {
  companyId?: string;
  ticker: string;
  issuerType: "LISTED_COMMON_EQUITY" | "OTHER";
  accountingModel: "NON_FINANCIAL" | "BANK" | "INSURANCE" | "OTHER_FINANCIAL";
  sector?: string;
  consolidated: boolean | null;
  audited: boolean | null;
  periodStart: string;
  periodEnd: string;
  periodType: "Q1" | "H1" | "Q3" | "FY" | "MONTHLY";
  currency: string;
  documentScale: string;
};

export type P0APlanTask = {
  stage: "PRIMARY" | "TARGETED";
  requirementIds: string[];
  selectedPages: number[];
  route: P0ASourceRoute;
  cacheKey: string;
};

export type P0AEvidence = {
  requirementId: string;
  pageNumber: number;
  printedPageLabel: string | null;
  statement: string;
  table: string | null;
  rowLabel: string;
  columnLabel: string;
  rawValue: string;
  snippet: string;
  snippetHash: string;
  locatorHash: string;
};

export type P0AObservation = {
  requirementId: string;
  origin: P0AFactOrigin;
  state: "VALUE" | "ZERO" | "NOT_APPLICABLE";
  decimalValue: string | null;
  rawValue: string;
  currency: string;
  unitType: P0AUnitType;
  scale: string;
  evidence: P0AEvidence[];
  sourceFactIds?: string[];
};

export type P0ARequirementOutcome = {
  requirementId: string;
  applicability: P0AExpectation;
  state: P0AValueState;
  reportedObservation: P0AObservation | null;
  calculatedAlternative: P0AObservation | null;
  attemptedRoutes: P0ASourceRoute[];
  attemptedPages: number[];
  reason: string;
};

export type P0AProviderUsage = {
  provider: string | null;
  model: string | null;
  selectedPageCount: number;
  requirementCount: number;
  providerRequestId: string | null;
  providerResponseId: string | null;
  retryCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  processingLatencyMs: number;
  estimatedCostUsd: string | null;
  billedCostUsd: string | null;
  providerCalls: number;
};
