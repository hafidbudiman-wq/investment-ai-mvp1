import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ticker = (url.searchParams.get("ticker") || "ICBP").trim().toUpperCase();
    const year = Number(url.searchParams.get("year") || "2025");
    const periodType = (url.searchParams.get("periodType") || "H1").trim().toUpperCase() as "Q1" | "H1" | "Q3" | "FY" | "MONTHLY";

    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return NextResponse.json({ error: "Year tidak valid." }, { status: 400 });
    }

    const report = await prisma.financialReport.findFirst({
      where: { company: { ticker }, year, periodType },
      include: {
        company: { select: { ticker: true, name: true } },
        entries: {
          where: { canonicalAccount: { code: { in: ["AR", "AP"] } } },
          include: { canonicalAccount: { select: { code: true, name: true, statementType: true } } },
          orderBy: { canonicalAccount: { code: "asc" } },
        },
        extractionRuns: {
          include: {
            candidates: {
              where: { canonicalAccount: { code: { in: ["AR", "AP"] } } },
              include: { canonicalAccount: { select: { code: true, name: true } } },
              orderBy: [{ sourcePage: "asc" }, { createdAt: "asc" }],
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!report) {
      return NextResponse.json({ error: `${ticker} ${periodType} ${year} tidak ditemukan di canonical database.` }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      report: {
        id: report.id,
        ticker: report.company.ticker,
        companyName: report.company.name,
        year: report.year,
        periodType: report.periodType,
        periodEnd: report.periodEnd,
        status: report.status,
        sourceFile: report.sourceFile,
      },
      canonicalEntries: report.entries.map((entry) => ({
        id: entry.id,
        code: entry.canonicalAccount.code,
        accountName: entry.canonicalAccount.name,
        value: entry.value.toString(),
        scale: entry.scale,
        currency: entry.currency,
        reportedLabel: entry.reportedLabel,
        rawText: entry.rawText,
        sourcePage: entry.sourcePage,
        isVerified: entry.isVerified,
        confidence: entry.confidence,
        createdAt: entry.createdAt,
      })),
      stagingCandidates: report.extractionRuns.flatMap((run) => run.candidates.map((candidate) => ({
        runId: run.id,
        runStatus: run.status,
        candidateId: candidate.id,
        code: candidate.canonicalAccount?.code ?? null,
        reportedLabel: candidate.reportedLabel,
        rawValue: candidate.rawValue,
        numericValue: candidate.numericValue?.toString() ?? null,
        scale: candidate.scale,
        status: candidate.status,
        sourcePage: candidate.sourcePage,
        reviewNote: candidate.reviewNote,
      }))),
      conclusion: {
        arInCanonical: report.entries.some((entry) => entry.canonicalAccount.code === "AR"),
        apInCanonical: report.entries.some((entry) => entry.canonicalAccount.code === "AP"),
      },
    });
  } catch (error) {
    console.error("canonical-ar-ap-diagnostic-failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Diagnostic gagal." }, { status: 500 });
  }
}
