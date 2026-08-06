import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CRITICAL_ACCOUNTS } from "@/lib/financial/critical-accounts.config";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const run = await prisma.extractionRun.findUnique({
      where: { id },
      include: {
        company: { select: { ticker: true, name: true } },
        chunks: { orderBy: { ordinal: "asc" }, select: { id: true, ordinal: true, chunkType: true, pageStart: true, pageEnd: true, section: true } },
        candidates: {
          orderBy: [{ sourcePage: "asc" }, { createdAt: "asc" }],
          include: { canonicalAccount: { select: { id: true, code: true, name: true, statementType: true } } },
        },
      },
    });
    if (!run) return NextResponse.json({ error: "Extraction run tidak ditemukan." }, { status: 404 });
    const accounts = await prisma.canonicalAccount.findMany({
      where: { isActive: true, isCalculated: false },
      select: { id: true, code: true, name: true, statementType: true },
      orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }],
    });
    const verifiedCodes = run.candidates
      .filter((candidate) => candidate.status === "ACCEPTED" && candidate.qualityStatus === "GREEN" && candidate.canonicalAccount)
      .map((candidate) => candidate.canonicalAccount!.code);
    const qualitySummary = {
      verifiedFacts: verifiedCodes.length,
      evidenceOnly: run.candidates.filter((candidate) => candidate.status === "REJECTED").length,
      exceptions: run.candidates.filter((candidate) => candidate.status === "PENDING").length,
      verifiedCodes,
      missingCodes: CRITICAL_ACCOUNTS.map((account) => account.code).filter((code) => !verifiedCodes.includes(code)),
    };
    return NextResponse.json({ ok: true, run, accounts, qualitySummary });
  } catch (error) {
    console.error("pdf-extraction-detail-failed", error);
    return NextResponse.json({ error: "Gagal membaca hasil extraction." }, { status: 500 });
  }
}
