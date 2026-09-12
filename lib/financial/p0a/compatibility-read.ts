import { Prisma, type PrismaClient, type ReportPeriodType } from "@prisma/client";
import { P0A_REQUIREMENT_BY_ID } from "@/lib/financial/p0a/requirements";
import { LEGACY_CLASSIFICATION_UNAVAILABLE } from "@/lib/financial/p0a/routing-snapshot";
import type { P0AValueState } from "@/lib/financial/p0a/types";

export type LegacyComparisonState =
  | "MATCH"
  | "DIFFERENT"
  | "NO_LEGACY_VALUE"
  | "NOT_COMPARABLE";

export type ExtractionQaEvidence = {
  pdfPage: number;
  printedPage: string | null;
  rowLabel: string;
  columnLabel: string;
  rawValue: string;
  snippet: string;
  snippetHash: string;
  evidenceHash: string;
  locatorHash: string;
};

export type ExtractionQaFact = {
  requirementId: string;
  code: string;
  name: string;
  definition: string;
  state: P0AValueState;
  value: string | null;
  rawValue: string | null;
  currency: string | null;
  unitType: string;
  scale: string | null;
  origin: string | null;
  statement: string;
  period: {
    start: string;
    end: string;
    type: string;
    consolidationScope: "CONSOLIDATED" | "SEPARATE" | "UNKNOWN";
  };
  sourcePage: number | null;
  readConfidence: string | null;
  mappingConfidence: string | null;
  evidenceStatus: "COMPLETE" | "MISSING" | "NOT_REQUIRED";
  source: "NATIVE" | "AI";
  standardizedAlternativeAvailable: boolean;
  legacyComparison: LegacyComparisonState;
  legacyComparisonReason: string;
  legacyValue: string | null;
  evidence: ExtractionQaEvidence[];
  lineage: {
    reportRevisionId: string;
    assertionId: string | null;
    assertionKey: string | null;
    definitionVersion: string | null;
  };
};

export type ExtractionQaReadModel = {
  summary: {
    passId: string;
    reportRevisionId: string;
    ticker: string;
    company: string;
    period: string;
    documentPages: number;
    selectedPages: number[];
    valueZeroCount: number;
    notApplicableCount: number;
    notDisclosedCount: number;
    missingCount: number;
    ambiguousCount: number;
    conflictCount: number;
    providerCalls: number;
    inputTokens: number;
    outputTokens: number;
    apiCostUsd: string;
    nativeLatencyMs: number;
    shadowOnly: boolean;
    routingClassificationStatus: "AVAILABLE" | typeof LEGACY_CLASSIFICATION_UNAVAILABLE;
  };
  versions: {
    contractVersion: string;
    parserVersion: string;
    routerVersion: string;
    applicabilityVersion: string;
    plannerVersion: string;
    gapVersion: string;
    validationVersion: string;
    mappingVersion: string;
    scopedPromptVersion: string;
  };
  facts: ExtractionQaFact[];
};

export type ExtractionQaQuery = {
  passId?: string;
  ticker?: string;
  year?: number;
  periodType?: string;
};

type LegacyEntry = {
  value: Prisma.Decimal;
  originalValue: Prisma.Decimal | null;
  scale: number;
  currency: string;
  canonicalAccount: { code: string; valueNature: string };
};

type LegacyContext = {
  companyId: string;
  periodStart: Date | null;
  periodEnd: Date;
  periodType: string;
  consolidated: boolean;
};

function sameUtcDay(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function scopeLabel(value: boolean | null): "CONSOLIDATED" | "SEPARATE" | "UNKNOWN" {
  return value === true ? "CONSOLIDATED" : value === false ? "SEPARATE" : "UNKNOWN";
}

function numericState(state: string): state is "VALUE" | "ZERO" {
  return state === "VALUE" || state === "ZERO";
}

export function compareLegacyFact(input: {
  newState: string;
  newValue: string | null;
  newCurrency: string | null;
  newScale: string | null;
  unitType: string;
  periodNature: "INSTANT" | "DURATION";
  code: string;
  companyId: string;
  periodStart: Date;
  periodEnd: Date;
  periodType: string;
  consolidated: boolean | null;
  legacyReport: LegacyContext | null;
  legacyEntry: LegacyEntry | null;
}): { state: LegacyComparisonState; reason: string; legacyValue: string | null } {
  if (!numericState(input.newState) || input.newValue === null) {
    return { state: "NOT_COMPARABLE", reason: "The shadow outcome is not a numeric VALUE/ZERO fact.", legacyValue: null };
  }
  if (!input.legacyReport) {
    return { state: "NO_LEGACY_VALUE", reason: "No legacy report exists for the requested company and period.", legacyValue: null };
  }
  const periodComparable = input.legacyReport.periodType === input.periodType
    && sameUtcDay(input.legacyReport.periodEnd, input.periodEnd)
    && (input.periodNature === "INSTANT" || sameUtcDay(input.legacyReport.periodStart, input.periodStart));
  const scopeComparable = input.consolidated !== null
    && input.legacyReport.consolidated === input.consolidated;
  if (input.legacyReport.companyId !== input.companyId || !periodComparable || !scopeComparable) {
    return { state: "NOT_COMPARABLE", reason: "Company, period, or consolidation scope is not safely comparable.", legacyValue: null };
  }
  if (!input.legacyEntry) {
    return { state: "NO_LEGACY_VALUE", reason: "The comparable legacy report has no value for this semantic code.", legacyValue: null };
  }
  if (input.legacyEntry.canonicalAccount.code !== input.code) {
    return { state: "NOT_COMPARABLE", reason: "Semantic codes do not match.", legacyValue: null };
  }
  const unitComparable = input.unitType === "DOCUMENT_CURRENCY"
    || (input.unitType === "PER_SHARE" && input.legacyEntry.canonicalAccount.valueNature === "PER_SHARE")
    || (input.unitType === "SHARES" && input.legacyEntry.currency === "SHARES");
  const currencyComparable = input.unitType === "SHARES"
    ? input.legacyEntry.currency === "SHARES"
    : input.newCurrency !== null && input.legacyEntry.currency === input.newCurrency;
  const scaleComparable = input.newScale !== null
    && new Prisma.Decimal(input.newScale).equals(input.legacyEntry.scale);
  if (!unitComparable || !currencyComparable || !scaleComparable) {
    return { state: "NOT_COMPARABLE", reason: "Currency, unit, or scale is not safely comparable.", legacyValue: null };
  }
  const legacyValue = (input.legacyEntry.originalValue ?? input.legacyEntry.value).toString();
  const matches = new Prisma.Decimal(input.newValue).equals(legacyValue);
  return {
    state: matches ? "MATCH" : "DIFFERENT",
    reason: matches ? "Comparable values are identical." : "Comparable values differ.",
    legacyValue,
  };
}

function jsonNumberArray(value: Prisma.JsonValue): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function jsonStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function sumCost(values: Array<Prisma.Decimal | null>): string {
  return values.reduce<Prisma.Decimal>(
    (total, value) => value ? total.plus(value) : total,
    new Prisma.Decimal(0),
  ).toFixed(8);
}

export async function readExtractionQa(
  client: PrismaClient,
  query: ExtractionQaQuery = {},
): Promise<ExtractionQaReadModel | null> {
  const ticker = (query.ticker ?? "ICBP").trim().toUpperCase();
  const year = query.year ?? 2025;
  const periodType = (query.periodType ?? "H1").trim().toUpperCase();
  const revision = query.passId
    ? await client.p0AReportRevision.findUnique({
      where: { passId: query.passId },
      include: {
        company: true,
        pass: {
          include: {
            tasks: { orderBy: [{ stage: "asc" }, { createdAt: "asc" }] },
            outcomes: {
              orderBy: { requirementId: "asc" },
              include: {
                reportedAssertion: {
                  include: {
                    evidence: { orderBy: { ordinal: "asc" }, include: { evidence: true } },
                  },
                },
              },
            },
          },
        },
      },
    })
    : await client.p0AReportRevision.findFirst({
      where: {
        company: { ticker },
        periodType,
        periodEnd: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      orderBy: { createdAt: "desc" },
      include: {
        company: true,
        pass: {
          include: {
            tasks: { orderBy: [{ stage: "asc" }, { createdAt: "asc" }] },
            outcomes: {
              orderBy: { requirementId: "asc" },
              include: {
                reportedAssertion: {
                  include: {
                    evidence: { orderBy: { ordinal: "asc" }, include: { evidence: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  if (!revision) return null;

  const pass = revision.pass;
  const documentPages = await client.p0ADocumentPage.count({
    where: { documentId: revision.documentId, parserVersion: pass.parserVersion },
  });
  const legacyReport = await client.financialReport.findUnique({
    where: {
      companyId_year_periodType: {
        companyId: revision.companyId,
        year: revision.periodEnd.getUTCFullYear(),
        periodType: revision.periodType as ReportPeriodType,
      },
    },
    include: {
      entries: { include: { canonicalAccount: { select: { code: true, valueNature: true } } } },
    },
  });
  const accountCodes = pass.outcomes
    .map((outcome) => P0A_REQUIREMENT_BY_ID.get(outcome.requirementId)?.legacyCode)
    .filter((code): code is string => Boolean(code));
  const accountNames = new Map((await client.canonicalAccount.findMany({
    where: { code: { in: accountCodes } },
    select: { code: true, name: true },
  })).map((account) => [account.code, account.name]));
  const legacyEntries = new Map((legacyReport?.entries ?? []).map((entry) => [entry.canonicalAccount.code, entry]));
  const totalProviderCalls = pass.tasks.reduce((total, task) => total + task.providerCalls, 0);

  const facts = pass.outcomes.map((outcome): ExtractionQaFact => {
    const requirement = P0A_REQUIREMENT_BY_ID.get(outcome.requirementId);
    const code = requirement?.legacyCode ?? outcome.requirementId.replace(/_REPORTED$/, "");
    const assertion = outcome.reportedAssertion;
    const evidence = (assertion?.evidence ?? []).map(({ evidence: item }) => ({
      pdfPage: item.pageNumber,
      printedPage: item.printedPageLabel,
      rowLabel: item.rowLabel,
      columnLabel: item.columnLabel,
      rawValue: item.rawValue,
      snippet: item.snippet,
      snippetHash: item.snippetHash,
      evidenceHash: item.evidenceHash,
      locatorHash: item.locatorHash,
    }));
    const comparison = compareLegacyFact({
      newState: outcome.state,
      newValue: assertion?.decimalValue?.toString() ?? null,
      newCurrency: assertion?.currency ?? null,
      newScale: assertion?.scale.toString() ?? null,
      unitType: assertion?.unitType ?? requirement?.unitType ?? "UNKNOWN",
      periodNature: requirement?.periodNature ?? "DURATION",
      code,
      companyId: revision.companyId,
      periodStart: revision.periodStart,
      periodEnd: revision.periodEnd,
      periodType: revision.periodType,
      consolidated: revision.consolidated,
      legacyReport: legacyReport ? {
        companyId: legacyReport.companyId,
        periodStart: legacyReport.periodStart,
        periodEnd: legacyReport.periodEnd,
        periodType: legacyReport.periodType,
        consolidated: legacyReport.consolidated,
      } : null,
      legacyEntry: legacyEntries.get(code) ?? null,
    });
    const evidenceRequired = ["VALUE", "ZERO", "NOT_APPLICABLE"].includes(outcome.state);
    const sourcedByAi = pass.tasks.some((task) =>
      task.providerCalls > 0
      && jsonStringArray(task.requirementIds).includes(outcome.requirementId)
      && (!evidence.length || evidence.some((item) => jsonNumberArray(task.selectedPages).includes(item.pdfPage))),
    );
    return {
      requirementId: outcome.requirementId,
      code,
      name: accountNames.get(code) ?? assertion?.rawLabel ?? code.replaceAll("_", " "),
      definition: requirement?.definition ?? "No frozen P0-A requirement definition is available.",
      state: outcome.state as P0AValueState,
      value: assertion?.decimalValue?.toString() ?? null,
      rawValue: assertion?.rawValue ?? null,
      currency: assertion?.currency ?? null,
      unitType: assertion?.unitType ?? requirement?.unitType ?? "UNKNOWN",
      scale: assertion?.scale.toString() ?? null,
      origin: assertion?.origin ?? null,
      statement: assertion?.statement ?? requirement?.statementType ?? "OTHER",
      period: {
        start: revision.periodStart.toISOString().slice(0, 10),
        end: revision.periodEnd.toISOString().slice(0, 10),
        type: revision.periodType,
        consolidationScope: scopeLabel(revision.consolidated),
      },
      sourcePage: evidence[0]?.pdfPage ?? null,
      readConfidence: assertion?.readConfidence?.toString() ?? null,
      mappingConfidence: assertion?.mappingConfidence?.toString() ?? null,
      evidenceStatus: evidence.length ? "COMPLETE" : evidenceRequired ? "MISSING" : "NOT_REQUIRED",
      source: sourcedByAi ? "AI" : "NATIVE",
      standardizedAlternativeAvailable: /standardized aggregate/i.test(outcome.reason),
      legacyComparison: comparison.state,
      legacyComparisonReason: comparison.reason,
      legacyValue: comparison.legacyValue,
      evidence,
      lineage: {
        reportRevisionId: revision.id,
        assertionId: assertion?.id ?? null,
        assertionKey: assertion?.assertionKey ?? null,
        definitionVersion: assertion?.definitionVersion ?? null,
      },
    };
  });
  const count = (state: P0AValueState) => facts.filter((fact) => fact.state === state).length;

  return {
    summary: {
      passId: pass.id,
      reportRevisionId: revision.id,
      ticker: revision.company.ticker,
      company: revision.company.name,
      period: `${revision.periodType} ${revision.periodEnd.getUTCFullYear()}`,
      documentPages,
      selectedPages: jsonNumberArray(pass.selectedPages),
      valueZeroCount: count("VALUE") + count("ZERO"),
      notApplicableCount: count("NOT_APPLICABLE"),
      notDisclosedCount: count("NOT_DISCLOSED"),
      missingCount: count("MISSING"),
      ambiguousCount: count("AMBIGUOUS"),
      conflictCount: count("CONFLICT"),
      providerCalls: totalProviderCalls,
      inputTokens: pass.tasks.reduce((total, task) => total + (task.inputTokens ?? 0), 0),
      outputTokens: pass.tasks.reduce((total, task) => total + (task.outputTokens ?? 0), 0),
      apiCostUsd: sumCost(pass.tasks.map((task) => task.billedCostUsd ?? task.estimatedCostUsd)),
      nativeLatencyMs: pass.tasks
        .filter((task) => task.providerCalls === 0)
        .reduce((total, task) => total + (task.processingLatencyMs ?? 0), 0),
      shadowOnly: pass.shadowMode && revision.status === "SHADOW",
      routingClassificationStatus: pass.routingSnapshot === null
        ? LEGACY_CLASSIFICATION_UNAVAILABLE
        : "AVAILABLE",
    },
    versions: {
      contractVersion: pass.contractVersion,
      parserVersion: pass.parserVersion,
      routerVersion: pass.routerVersion,
      applicabilityVersion: pass.applicabilityVersion,
      plannerVersion: pass.plannerVersion,
      gapVersion: pass.gapVersion,
      validationVersion: pass.validationVersion,
      mappingVersion: pass.mappingVersion,
      scopedPromptVersion: pass.scopedPromptVersion,
    },
    facts,
  };
}
