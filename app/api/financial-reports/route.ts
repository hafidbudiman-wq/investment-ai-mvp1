import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SourceType, StatementType, WarningSeverity } from "@prisma/client";
import { z } from "zod";

const payloadSchema = z.object({
  companyId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  periodType: z.enum(["Q1", "H1", "Q3", "FY"]),
  audited: z.boolean().default(false),
  sourceFile: z.string().max(255).optional(),
  values: z.object({
    REV: z.number().finite(),
    NET_PROFIT: z.number().finite(),
    TOTAL_ASSETS: z.number().finite(),
    TOTAL_LIAB: z.number().finite(),
    EQUITY: z.number().finite(),
    OCF: z.number().finite(),
  }),
});

const periodMonth = { Q1: 3, H1: 6, Q3: 9, FY: 12 } as const;

export async function POST(request: Request) {
  try {
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Data input tidak valid.", details: parsed.error.flatten() }, { status: 400 });
    const payload = parsed.data;

    const company = await prisma.company.findUnique({ where: { id: payload.companyId } });
    if (!company) return NextResponse.json({ error: "Perusahaan tidak ditemukan." }, { status: 404 });

    const codes = Object.keys(payload.values);
    const accounts = await prisma.canonicalAccount.findMany({ where: { code: { in: codes } } });
    const accountMap = new Map(accounts.map((account) => [account.code, account]));
    const missing = codes.filter((code) => !accountMap.has(code));
    if (missing.length) return NextResponse.json({ error: `Canonical account belum tersedia: ${missing.join(", ")}` }, { status: 400 });

    const warnings: Array<{ code: string; message: string; severity: WarningSeverity }> = [];
    const assets = payload.values.TOTAL_ASSETS;
    const liabilities = payload.values.TOTAL_LIAB;
    const equity = payload.values.EQUITY;
    const difference = Math.abs(assets - liabilities - equity);
    const tolerance = Math.max(Math.abs(assets) * 0.005, 1);
    if (difference > tolerance) warnings.push({ code: "BALANCE_MISMATCH", message: `Total assets tidak sama dengan liabilities + equity. Selisih: ${difference.toLocaleString("id-ID")}.`, severity: WarningSeverity.HIGH });

    const netProfit = payload.values.NET_PROFIT;
    const ocf = payload.values.OCF;
    if (netProfit > 0 && ocf < netProfit * 0.5) warnings.push({ code: "LOW_CASH_CONVERSION", message: "Operating cash flow kurang dari 50% net profit.", severity: WarningSeverity.MEDIUM });

    const month = periodMonth[payload.periodType];
    const periodEnd = new Date(Date.UTC(payload.year, month, 0));

    const report = await prisma.$transaction(async (tx) => {
      const existing = await tx.financialReport.findUnique({
        where: { companyId_year_periodType: { companyId: payload.companyId, year: payload.year, periodType: payload.periodType } },
        include: { entries: true, warnings: true },
      });

      const savedReport = await tx.financialReport.upsert({
        where: { companyId_year_periodType: { companyId: payload.companyId, year: payload.year, periodType: payload.periodType } },
        update: { periodEnd, audited: payload.audited, sourceType: SourceType.MANUAL, sourceFile: payload.sourceFile ?? null, status: warnings.length ? "PENDING_REVIEW" : "VERIFIED" },
        create: { companyId: payload.companyId, year: payload.year, periodType: payload.periodType, periodEnd, audited: payload.audited, sourceType: SourceType.MANUAL, sourceFile: payload.sourceFile ?? null, status: warnings.length ? "PENDING_REVIEW" : "VERIFIED" },
      });

      await tx.dataWarning.deleteMany({ where: { reportId: savedReport.id } });
      await tx.financialEntry.deleteMany({ where: { reportId: savedReport.id } });

      const statementTypes = [...new Set(accounts.map((account) => account.statementType))].filter((type) => type !== StatementType.OTHER);
      const statementMap = new Map<StatementType, string>();
      for (const statementType of statementTypes) {
        const statement = await tx.financialStatement.upsert({
          where: { reportId_statementType: { reportId: savedReport.id, statementType } },
          update: { currency: company.currency, isConsolidated: true },
          create: { reportId: savedReport.id, statementType, currency: company.currency, isConsolidated: true },
        });
        statementMap.set(statementType, statement.id);
      }

      await tx.financialEntry.createMany({
        data: Object.entries(payload.values).map(([code, value]) => {
          const account = accountMap.get(code)!;
          return {
            reportId: savedReport.id,
            statementId: statementMap.get(account.statementType) ?? null,
            canonicalAccountId: account.id,
            reportedLabel: account.name,
            value,
            currency: company.currency,
            isVerified: true,
            confidence: 1,
          };
        }),
      });

      if (warnings.length) await tx.dataWarning.createMany({ data: warnings.map((warning) => ({ ...warning, reportId: savedReport.id })) });

      await tx.auditLog.create({
        data: {
          reportId: savedReport.id,
          action: existing ? "MANUAL_REPORT_UPDATED" : "MANUAL_REPORT_CREATED",
          actor: "web-user",
          entity: "FinancialReport",
          entityId: savedReport.id,
          before: existing ? { status: existing.status, values: existing.entries.length, warnings: existing.warnings.length } : undefined,
          after: { status: warnings.length ? "PENDING_REVIEW" : "VERIFIED", values: Object.keys(payload.values).length, warnings: warnings.length },
          note: `${Object.keys(payload.values).length} canonical values saved.`,
        },
      });
      return savedReport;
    });

    return NextResponse.json({ ok: true, reportId: report.id, status: report.status, warnings });
  } catch (error) {
    console.error("financial-report-save-failed", error);
    return NextResponse.json({ error: "Gagal menyimpan laporan ke database." }, { status: 500 });
  }
}
