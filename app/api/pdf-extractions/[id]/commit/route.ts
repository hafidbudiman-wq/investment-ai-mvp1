import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function periodEnd(year: number, period: "Q1" | "H1" | "Q3" | "FY" | "MONTHLY") {
  if (period === "Q1") return new Date(Date.UTC(year, 2, 31));
  if (period === "H1") return new Date(Date.UTC(year, 5, 30));
  if (period === "Q3") return new Date(Date.UTC(year, 8, 30));
  return new Date(Date.UTC(year, 11, 31));
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const run = await prisma.extractionRun.findUnique({
      where: { id },
      include: { candidates: { include: { canonicalAccount: true } }, company: true },
    });
    if (!run) return NextResponse.json({ error: "Extraction run tidak ditemukan." }, { status: 404 });
    if (run.status === "COMMITTED") return NextResponse.json({ ok: true, reportId: run.reportId, message: "Extraction ini sudah pernah di-commit." });
    if (!run.year || !run.periodType) return NextResponse.json({ error: "Year/period hasil extraction belum valid." }, { status: 400 });

    const pending = run.candidates.filter((c) => c.status === "PENDING");
    if (pending.length) return NextResponse.json({ error: `Masih ada ${pending.length} candidate yang belum direview.` }, { status: 400 });
    const accepted = run.candidates.filter((c) => c.status === "ACCEPTED" && c.canonicalAccountId && c.numericValue !== null);
    if (!accepted.length) return NextResponse.json({ error: "Tidak ada candidate ACCEPTED untuk disimpan." }, { status: 400 });

    const duplicateCodes = accepted.map((c) => c.canonicalAccountId!).filter((accountId, index, arr) => arr.indexOf(accountId) !== index);
    if (duplicateCodes.length) return NextResponse.json({ error: "Ada lebih dari satu candidate ACCEPTED untuk canonical account yang sama. Reject salah satunya sebelum commit." }, { status: 400 });

    const valueByCode = new Map(accepted.filter((c) => c.canonicalAccount).map((c) => [c.canonicalAccount!.code, Number(c.numericValue) * Number(c.scale || 1)]));
    const assets = valueByCode.get("TOTAL_ASSETS");
    const liabilities = valueByCode.get("TOTAL_LIAB");
    const equity = valueByCode.get("EQUITY");
    if (assets !== undefined && liabilities !== undefined && equity !== undefined) {
      const difference = Math.abs(assets - liabilities - equity);
      const tolerance = Math.max(Math.abs(assets) * 0.0001, 1);
      if (difference > tolerance) return NextResponse.json({ error: `Balance Sheet validation gagal: Assets tidak sama dengan Liabilities + Equity (selisih ${difference}). Periksa kandidat sebelum commit.` }, { status: 422 });
    }

    const existingReport = await prisma.financialReport.findUnique({ where: { companyId_year_periodType: { companyId: run.companyId, year: run.year, periodType: run.periodType } } });
    if (existingReport && existingReport.id !== run.reportId) return NextResponse.json({ error: `${run.company.ticker} ${run.periodType} ${run.year} sudah ada di canonical database. Commit diblokir agar data lama tidak tertimpa.` }, { status: 409 });

    const reportId = await prisma.$transaction(async (tx) => {
      const report = existingReport ?? await tx.financialReport.create({
        data: { companyId: run.companyId, year: run.year!, periodType: run.periodType!, periodEnd: periodEnd(run.year!, run.periodType!), sourceType: "PDF", sourceFile: run.fileName, status: "VERIFIED", createdBy: "pdf-ai-extraction" },
      });
      const statementTypes = [...new Set(accepted.map((c) => c.canonicalAccount?.statementType).filter((v): v is "INCOME_STATEMENT" | "BALANCE_SHEET" | "CASH_FLOW" | "OTHER" => Boolean(v)))];
      const statements = new Map<string, string>();
      for (const type of statementTypes) {
        const statement = await tx.financialStatement.upsert({ where: { reportId_statementType: { reportId: report.id, statementType: type } }, update: { currency: run.currency || run.company.currency, unitScale: run.unitScale || 1 }, create: { reportId: report.id, statementType: type, currency: run.currency || run.company.currency, unitScale: run.unitScale || 1 } });
        statements.set(type, statement.id);
      }
      for (const candidate of accepted) {
        const account = candidate.canonicalAccount!;
        await tx.financialEntry.create({ data: { reportId: report.id, statementId: statements.get(account.statementType) ?? null, canonicalAccountId: candidate.canonicalAccountId!, reportedLabel: candidate.reportedLabel, rawText: candidate.sourceText || candidate.rawValue, value: candidate.numericValue!, scale: candidate.scale, currency: candidate.currency || run.currency || run.company.currency, isEstimated: true, isVerified: true, confidence: Math.min(candidate.extractionConfidence ?? 0, candidate.mappingConfidence ?? 0), sourcePage: candidate.sourcePage } });
        await tx.extractionCandidate.update({ where: { id: candidate.id }, data: { status: "COMMITTED" } });
      }
      await tx.sourceFile.create({ data: { reportId: report.id, sourceType: "PDF", fileName: run.fileName, mimeType: run.mimeType, fileSize: run.fileSize, checksum: run.checksum } });
      await tx.auditLog.create({ data: { reportId: report.id, action: "PDF_AI_COMMIT", actor: "web-user", entity: "ExtractionRun", entityId: run.id, note: `${accepted.length} reviewed PDF candidates committed to canonical database after validation.` } });
      await tx.extractionRun.update({ where: { id: run.id }, data: { status: "COMMITTED", reportId: report.id } });
      return report.id;
    });
    return NextResponse.json({ ok: true, reportId, message: `${accepted.length} reviewed accounts berhasil masuk canonical PostgreSQL.` });
  } catch (error) {
    console.error("pdf-extraction-commit-failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Commit gagal." }, { status: 500 });
  }
}
