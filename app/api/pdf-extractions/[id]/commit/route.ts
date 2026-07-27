import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function periodEnd(year: number, period: "Q1" | "H1" | "Q3" | "FY" | "MONTHLY") {
  if (period === "Q1") return new Date(Date.UTC(year, 2, 31));
  if (period === "H1") return new Date(Date.UTC(year, 5, 30));
  if (period === "Q3") return new Date(Date.UTC(year, 8, 30));
  return new Date(Date.UTC(year, 11, 31));
}

function relationComponentKind(label: string) {
  const normalized = label.toLowerCase();
  if (/pihak\s+ketiga|third\s+part/.test(normalized)) return "THIRD_PARTY";
  if (/pihak\s+berelasi|pihak\s+berhubungan|related\s+part/.test(normalized)) return "RELATED_PARTY";
  return null;
}

function debtFlowComponentKind(label: string) {
  const normalized = label.toLowerCase();
  if (/jangka\s+pendek|short[-\s]?term|overdraft|trust\s+receipt/.test(normalized)) return "SHORT_TERM";
  if (/jangka\s+panjang|long[-\s]?term/.test(normalized)) return "LONG_TERM";
  return "OTHER_DEBT_FLOW";
}

function canSafelyAggregate(code: string | undefined, candidates: Array<{ reportedLabel: string }>) {
  if (!code || candidates.length <= 1) return candidates.length <= 1;

  if (code === "AR" || code === "AP") {
    const kinds = candidates.map((candidate) => relationComponentKind(candidate.reportedLabel));
    const uniqueKinds = new Set(kinds.filter(Boolean));
    return kinds.every(Boolean) && uniqueKinds.has("THIRD_PARTY") && uniqueKinds.has("RELATED_PARTY");
  }

  if (code === "DEBT_ISSUED" || code === "DEBT_REPAID") {
    // Cash-flow debt movements are one economic metric even when the filing
    // splits them into short-term and long-term borrowing components.
    // We preserve each reviewed source component in provenance, then store
    // the summed canonical fact for the reporting period.
    const kinds = candidates.map((candidate) => debtFlowComponentKind(candidate.reportedLabel));
    return new Set(kinds).size === candidates.length;
  }

  return false;
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

    const groupedAccepted = new Map<string, typeof accepted>();
    for (const candidate of accepted) {
      const accountId = candidate.canonicalAccountId!;
      groupedAccepted.set(accountId, [...(groupedAccepted.get(accountId) ?? []), candidate]);
    }

    for (const candidates of groupedAccepted.values()) {
      if (candidates.length <= 1) continue;
      const code = candidates[0].canonicalAccount?.code;
      if (!canSafelyAggregate(code, candidates)) {
        return NextResponse.json({ error: `Ada lebih dari satu candidate ACCEPTED untuk ${code ?? "canonical account yang sama"}. Aggregation otomatis belum aman untuk kombinasi ini. Periksa mapping sebelum commit.` }, { status: 400 });
      }
    }

    const valueByCode = new Map<string, number>();
    for (const candidates of groupedAccepted.values()) {
      const code = candidates[0].canonicalAccount?.code;
      if (!code) continue;
      valueByCode.set(code, candidates.reduce((sum, candidate) => sum + Number(candidate.numericValue) * Number(candidate.scale || 1), 0));
    }
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

      for (const candidates of groupedAccepted.values()) {
        const first = candidates[0];
        const account = first.canonicalAccount!;
        const sameScale = candidates.every((candidate) => candidate.scale === first.scale);
        const value = sameScale
          ? candidates.reduce((sum, candidate) => sum + Number(candidate.numericValue), 0)
          : candidates.reduce((sum, candidate) => sum + Number(candidate.numericValue) * Number(candidate.scale || 1), 0);
        const scale = sameScale ? first.scale : 1;
        const sourcePages = [...new Set(candidates.map((candidate) => candidate.sourcePage).filter((page): page is number => page !== null))];
        const provenance = candidates.map((candidate) => `${candidate.reportedLabel}: ${candidate.rawValue}${candidate.sourcePage ? ` (page ${candidate.sourcePage})` : ""}`).join(" | ");
        const reportedLabel = candidates.length > 1 ? `${account.name} — aggregated from ${candidates.length} reviewed components` : first.reportedLabel;
        const confidence = Math.min(...candidates.map((candidate) => Math.min(candidate.extractionConfidence ?? 0, candidate.mappingConfidence ?? 0)));

        await tx.financialEntry.create({ data: { reportId: report.id, statementId: statements.get(account.statementType) ?? null, canonicalAccountId: first.canonicalAccountId!, reportedLabel, rawText: provenance || first.sourceText || first.rawValue, value, scale, currency: first.currency || run.currency || run.company.currency, isEstimated: true, isVerified: true, confidence, sourcePage: sourcePages.length === 1 ? sourcePages[0] : null } });
        for (const candidate of candidates) {
          await tx.extractionCandidate.update({ where: { id: candidate.id }, data: { status: "COMMITTED", reviewNote: candidates.length > 1 ? `Aggregated into canonical ${account.code} with reviewed ${candidates.length} components.` : candidate.reviewNote } });
        }
      }
      await tx.sourceFile.create({ data: { reportId: report.id, sourceType: "PDF", fileName: run.fileName, mimeType: run.mimeType, fileSize: run.fileSize, checksum: run.checksum } });
      await tx.auditLog.create({ data: { reportId: report.id, action: "PDF_AI_COMMIT", actor: "web-user", entity: "ExtractionRun", entityId: run.id, note: `${accepted.length} reviewed PDF candidates committed into ${groupedAccepted.size} canonical financial facts after validation. Safe aggregation supports AR/AP counterparties and DEBT_ISSUED/DEBT_REPAID maturity components; provenance is preserved in FinancialEntry.rawText.` } });
      await tx.extractionRun.update({ where: { id: run.id }, data: { status: "COMMITTED", reportId: report.id } });
      return report.id;
    });
    return NextResponse.json({ ok: true, reportId, message: `${groupedAccepted.size} canonical financial facts berhasil masuk PostgreSQL dari ${accepted.length} reviewed candidates.` });
  } catch (error) {
    console.error("pdf-extraction-commit-failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Commit gagal." }, { status: 500 });
  }
}
