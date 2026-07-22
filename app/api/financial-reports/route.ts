import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const payloadSchema = z.object({
  companyId: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(2100),
  periodType: z.enum(["Q1", "H1", "Q3", "FY", "MONTHLY"]),
  audited: z.boolean().optional().default(false),
  sourceFile: z.string().optional().nullable(),
  values: z.record(z.coerce.number().finite()),
});

const periodMonth: Record<string, number> = { Q1: 3, H1: 6, Q3: 9, FY: 12, MONTHLY: 12 };

export async function POST(request: Request) {
  try {
    const payload = payloadSchema.parse(await request.json());
    const company = await prisma.company.findUnique({ where: { id: payload.companyId } });
    if (!company) return NextResponse.json({ error: "Company tidak ditemukan." }, { status: 404 });

    const codes = Object.keys(payload.values);
    const accounts = await prisma.canonicalAccount.findMany({ where: { code: { in: codes } } });
    const accountMap = new Map(accounts.map((account) => [account.code, account]));
    const missing = codes.filter((code) => !accountMap.has(code));
    if (missing.length) {
      return NextResponse.json({ error: `Canonical account belum tersedia: ${missing.join(", ")}` }, { status: 400 });
    }

    const warnings: Array<{ code: string; message: string; severity: string }> = [];
    const assets = payload.values.TOTAL_ASSETS;
    const liabilities = payload.values.TOTAL_LIAB;
    const equity = payload.values.EQUITY;
    if ([assets, liabilities, equity].every((value) => Number.isFinite(value))) {
      const difference = Math.abs(assets - liabilities - equity);
      const tolerance = Math.max(Math.abs(assets) * 0.005, 1);
      if (difference > tolerance) warnings.push({ code: "BALANCE_MISMATCH", message: `Total assets tidak sama dengan liabilities + equity. Selisih: ${difference.toLocaleString("id-ID")}.`, severity: "HIGH" });
    }

    const netProfit = payload.values.NET_PROFIT;
    const ocf = payload.values.OCF;
    if (Number.isFinite(netProfit) && Number.isFinite(ocf) && netProfit > 0 && ocf < netProfit * 0.5) {
      warnings.push({ code: "LOW_CASH_CONVERSION", message: "Operating cash flow kurang dari 50% net profit.", severity: "MEDIUM" });
    }

    const month = periodMonth[payload.periodType] ?? 12;
    const periodEnd = new Date(Date.UTC(payload.year, month, 0));

    const report = await prisma.$transaction(async (tx) => {
      const savedReport = await tx.financialReport.upsert({
        where: { companyId_year_periodType: { companyId: payload.companyId, year: payload.year, periodType: payload.periodType } },
        update: { periodEnd, audited: payload.audited, sourceFile: payload.sourceFile ?? null, status: warnings.length ? "PENDING_REVIEW" : "VERIFIED" },
        create: { companyId: payload.companyId, year: payload.year, periodType: payload.periodType, periodEnd, audited: payload.audited, sourceFile: payload.sourceFile ?? null, status: warnings.length ? "PENDING_REVIEW" : "VERIFIED" },
      });

      await tx.dataWarning.deleteMany({ where: { reportId: savedReport.id } });
      await tx.financialEntry.deleteMany({ where: { reportId: savedReport.id } });

      await tx.financialEntry.createMany({
        data: Object.entries(payload.values).map(([code, value]) => ({
          reportId: savedReport.id,
          canonicalAccountId: accountMap.get(code)!.id,
          reportedLabel: accountMap.get(code)!.name,
          value,
          currency: company.currency,
          isVerified: true,
        })),
      });

      if (warnings.length) await tx.dataWarning.createMany({ data: warnings.map((warning) => ({ ...warning, reportId: savedReport.id })) });
      return savedReport;
    });

    return NextResponse.json({ ok: true, reportId: report.id, status: report.status, warnings });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Data input belum lengkap atau formatnya salah.", details: error.flatten() }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "Gagal menyimpan laporan keuangan." }, { status: 500 });
  }
}
