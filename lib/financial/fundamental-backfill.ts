import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FUNDAMENTAL_BACKFILL_DATASETS, type FundamentalBackfillDataset } from "./fundamental-backfill-data";

const ACTOR = "curated-fundamental-backfill-v1";
const AUDIT_ACTION = "FUNDAMENTAL_BACKFILL_V1";
const UNIT_VALUE_CODES = new Set(["EPS_BASIC", "EPS_DILUTED", "SHARES_ISSUED", "TREASURY_SHARES", "SHARES_OUTSTANDING", "WEIGHTED_AVG_SHARES"]);
const EXPENSE_CODES = new Set(["COGS", "SGA", "FINANCE_COST", "TAX_EXPENSE"]);
const CASH_OUTFLOW_CODES = new Set(["CAPEX", "ICF", "CFF", "DIVIDENDS_PAID", "DEBT_REPAID"]);

export type FundamentalBackfillResult = {
  ticker: string;
  reportId?: string;
  status: "APPLIED" | "ALREADY_APPLIED" | "WAITING_FOR_VERIFIED_REPORT" | "WAITING_FOR_CANONICAL_ACCOUNTS";
  facts: number;
  reason?: string;
};

function signConvention(code: string): string {
  if (EXPENSE_CODES.has(code)) return "EXPENSE_POSITIVE";
  if (CASH_OUTFLOW_CODES.has(code)) return "CASH_OUTFLOW_NEGATIVE";
  if (["OCF", "FCF", "DEBT_ISSUED", "NET_CHANGE_CASH"].includes(code)) return "CASH_INFLOW_POSITIVE";
  return "POSITIVE";
}

async function applyDataset(dataset: FundamentalBackfillDataset): Promise<FundamentalBackfillResult> {
  const report = await prisma.financialReport.findFirst({
    where: {
      company: { ticker: dataset.ticker },
      year: dataset.year,
      periodType: dataset.periodType,
      status: "VERIFIED",
      OR: [
        { sourceFiles: { some: { checksum: dataset.checksum } } },
        { extractionRuns: { some: { checksum: dataset.checksum } } },
      ],
    },
    include: {
      extractionRuns: {
        where: { checksum: dataset.checksum },
        select: { id: true, documentId: true },
        take: 1,
      },
    },
  });

  if (!report) {
    return {
      ticker: dataset.ticker,
      status: "WAITING_FOR_VERIFIED_REPORT",
      facts: 0,
      reason: "The checksum-matched report has not been explicitly saved as VERIFIED.",
    };
  }

  const existingAudit = await prisma.auditLog.findFirst({
    where: { reportId: report.id, action: AUDIT_ACTION, entity: "FinancialReport", entityId: report.id },
    select: { id: true },
  });
  if (existingAudit) return { ticker: dataset.ticker, reportId: report.id, status: "ALREADY_APPLIED", facts: dataset.facts.length };

  const codes = [...new Set(dataset.facts.map((item) => item.code))];
  const accounts = await prisma.canonicalAccount.findMany({ where: { code: { in: codes }, isActive: true } });
  const accountByCode = new Map(accounts.map((account) => [account.code, account]));
  const missingCodes = codes.filter((code) => !accountByCode.has(code));
  if (missingCodes.length) {
    return {
      ticker: dataset.ticker,
      reportId: report.id,
      status: "WAITING_FOR_CANONICAL_ACCOUNTS",
      facts: 0,
      reason: `Seed is not ready for: ${missingCodes.join(", ")}`,
    };
  }

  const lineage = report.extractionRuns[0] ?? null;
  await prisma.$transaction(async (tx) => {
    const statementIds = new Map<string, string>();
    for (const statementType of ["BALANCE_SHEET", "INCOME_STATEMENT", "CASH_FLOW"] as const) {
      const statement = await tx.financialStatement.upsert({
        where: { reportId_statementType: { reportId: report.id, statementType } },
        update: { currency: dataset.currency, unitScale: dataset.unitScale, isConsolidated: true },
        create: { reportId: report.id, statementType, currency: dataset.currency, unitScale: dataset.unitScale, isConsolidated: true },
        select: { id: true },
      });
      statementIds.set(statementType, statement.id);
    }

    const reviewedAt = new Date();
    for (const item of dataset.facts) {
      const account = accountByCode.get(item.code)!;
      const scale = UNIT_VALUE_CODES.has(item.code) || item.currency === "SHARES" ? 1 : dataset.unitScale;
      const normalizedValue = item.value * scale;
      const currency = item.currency ?? dataset.currency;
      const provenance = `${item.label} | checksum ${dataset.checksum} | PDF page ${item.sourcePage}`;
      const update: Prisma.FinancialEntryUpdateInput = {
        statement: { connect: { id: statementIds.get(item.statementType)! } },
        reportedLabel: item.label,
        rawText: provenance,
        value: item.value,
        originalValue: item.value,
        normalizedValue,
        originalRawValue: String(item.value),
        scale,
        currency,
        signConvention: signConvention(item.code),
        isEstimated: false,
        isVerified: true,
        confidence: 1,
        sourcePage: item.sourcePage,
        reviewStatus: "VERIFIED",
        reviewedBy: ACTOR,
        reviewedAt,
      };
      const create: Prisma.FinancialEntryUncheckedCreateInput = {
        reportId: report.id,
        statementId: statementIds.get(item.statementType)!,
        canonicalAccountId: account.id,
        reportedLabel: item.label,
        rawText: provenance,
        value: item.value,
        originalValue: item.value,
        normalizedValue,
        originalRawValue: String(item.value),
        scale,
        currency,
        signConvention: signConvention(item.code),
        isEstimated: false,
        isVerified: true,
        confidence: 1,
        sourcePage: item.sourcePage,
        sourceDocumentId: lineage?.documentId ?? null,
        extractionRunId: lineage?.id ?? null,
        reviewStatus: "VERIFIED",
        reviewedBy: ACTOR,
        reviewedAt,
      };
      await tx.financialEntry.upsert({
        where: { reportId_canonicalAccountId: { reportId: report.id, canonicalAccountId: account.id } },
        update,
        create,
      });
    }

    await tx.auditLog.create({
      data: {
        reportId: report.id,
        action: AUDIT_ACTION,
        actor: ACTOR,
        entity: "FinancialReport",
        entityId: report.id,
        after: { version: dataset.version, checksum: dataset.checksum, facts: dataset.facts.length },
        note: `${dataset.facts.length} checksum-locked fundamental facts backfilled by upsert without OpenAI API. Existing report and reviewed lineage were preserved.`,
      },
    });
  });

  return { ticker: dataset.ticker, reportId: report.id, status: "APPLIED", facts: dataset.facts.length };
}

export async function backfillVerifiedFundamentalFacts(): Promise<FundamentalBackfillResult[]> {
  const results: FundamentalBackfillResult[] = [];
  for (const dataset of FUNDAMENTAL_BACKFILL_DATASETS) results.push(await applyDataset(dataset));
  return results;
}
