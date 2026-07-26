import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inspectPdfForOcr, sha256, validatePdfUpload } from "@/lib/pdf-extraction";
import { extractFinancialPdfWithOpenAI } from "@/lib/openai-financial-extraction";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    const runs = await prisma.extractionRun.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { company: { select: { ticker: true, name: true } }, _count: { select: { chunks: true, candidates: true } } } });
    return NextResponse.json({ ok: true, runs });
  } catch (error) { console.error("pdf-extraction-list-failed", error); return NextResponse.json({ error: "Gagal membaca staging PDF." }, { status: 500 }); }
}

export async function POST(request: Request) {
  let runId: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file"); const companyId = String(form.get("companyId") ?? ""); const yearValue = String(form.get("year") ?? ""); const periodType = String(form.get("periodType") ?? "");
    if (!(file instanceof File)) return NextResponse.json({ error: "PDF belum dipilih." }, { status: 400 });
    if (!companyId) return NextResponse.json({ error: "Company wajib dipilih." }, { status: 400 });
    validatePdfUpload(file);
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, ticker: true, name: true, currency: true } });
    if (!company) return NextResponse.json({ error: "Company tidak ditemukan." }, { status: 404 });
    const bytes = Buffer.from(await file.arrayBuffer()); const checksum = sha256(bytes); const preflight = inspectPdfForOcr(bytes);
    const existing = await prisma.extractionRun.findUnique({ where: { companyId_checksum: { companyId, checksum } }, include: { _count: { select: { chunks: true, candidates: true } } } });
    if (existing) return NextResponse.json({ ok: true, duplicate: true, run: existing, runId: existing.id, message: "PDF yang sama sudah pernah diproses. Tidak dibuat duplikat." });
    const year = /^\d{4}$/.test(yearValue) ? Number(yearValue) : null; const allowedPeriods = ["Q1", "H1", "Q3", "FY", "MONTHLY"] as const; const safePeriod = allowedPeriods.includes(periodType as any) ? (periodType as (typeof allowedPeriods)[number]) : null;
    const run = await prisma.extractionRun.create({ data: { companyId, fileName: file.name, mimeType: file.type, fileSize: file.size, checksum, year, periodType: safePeriod, currency: company.currency, status: "PROCESSING", parserVersion: "mvp-1.2d-v2-ocr-smart-chunk" } }); runId = run.id;
    const accounts = await prisma.canonicalAccount.findMany({ where: { isActive: true, isCalculated: false }, select: { id: true, code: true, name: true, statementType: true, aliases: true }, orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }] });
    const extracted = await extractFinancialPdfWithOpenAI({ bytes, fileName: file.name, companyTicker: company.ticker, companyName: company.name, expectedYear: year, expectedPeriodType: safePeriod, accounts, preflight });
    const accountByCode = new Map(accounts.map((account) => [account.code.toUpperCase(), account]));
    const chunks = extracted.chunks.length ? extracted.chunks : [{ section: "Financial Statements", chunkType: "SECTION" as const, pageStart: null, pageEnd: null, textSummary: "AI extraction result" }];
    await prisma.$transaction(async (tx) => {
      for (let index = 0; index < chunks.length; index++) { const chunk = chunks[index]; await tx.extractionChunk.create({ data: { runId: run.id, ordinal: index + 1, chunkType: chunk.chunkType, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, section: chunk.section, text: chunk.textSummary.slice(0, 12000), textHash: sha256(Buffer.from(chunk.textSummary)), metadata: { processingMode: preflight.processingMode, preflightConfidence: preflight.confidence, preflightReason: preflight.reason } } }); }
      for (const candidate of extracted.candidates) { if (candidate.numericValue === null || !Number.isFinite(candidate.numericValue)) continue; const canonical = candidate.canonicalCode ? accountByCode.get(candidate.canonicalCode.toUpperCase()) : undefined; const matchingChunk = chunks.findIndex((chunk) => candidate.sourcePage != null && chunk.pageStart != null && chunk.pageEnd != null && candidate.sourcePage >= chunk.pageStart && candidate.sourcePage <= chunk.pageEnd); const storedChunk = matchingChunk >= 0 ? await tx.extractionChunk.findUnique({ where: { runId_ordinal: { runId: run.id, ordinal: matchingChunk + 1 } }, select: { id: true } }) : null; await tx.extractionCandidate.create({ data: { runId: run.id, chunkId: storedChunk?.id ?? null, statementType: candidate.statementType, reportedLabel: candidate.reportedLabel.slice(0, 500), normalizedLabel: candidate.reportedLabel.trim().toLowerCase().slice(0, 500), rawValue: candidate.rawValue.slice(0, 250), numericValue: candidate.numericValue, currency: candidate.currency || extracted.detectedCurrency || company.currency, scale: candidate.scale || extracted.detectedUnitScale || 1, sourcePage: candidate.sourcePage, sourceText: candidate.sourceText?.slice(0, 2000) ?? null, canonicalAccountId: canonical?.id ?? null, extractionConfidence: Math.max(0, Math.min(1, candidate.extractionConfidence)), mappingConfidence: canonical ? Math.max(0, Math.min(1, candidate.mappingConfidence)) : 0, mappingMethod: canonical ? "AI_SUGGESTED" : null, status: "PENDING" } }); }
      await tx.extractionRun.update({ where: { id: run.id }, data: { status: "PENDING_REVIEW", pageCount: extracted.pageCount, year: extracted.detectedYear || year, periodType: extracted.detectedPeriodType || safePeriod, currency: extracted.detectedCurrency || company.currency, unitScale: extracted.detectedUnitScale || null, errorMessage: null } });
    });
    return NextResponse.json({ ok: true, duplicate: false, runId: run.id, candidateCount: extracted.candidates.length, chunkCount: chunks.length, processingMode: preflight.processingMode, preflightReason: preflight.reason, message: `PDF selesai diproses via ${preflight.processingMode}: ${extracted.candidates.length} kandidat menunggu review. Belum ada nilai yang ditulis ke canonical database.` });
  } catch (error) { console.error("pdf-extraction-upload-failed", error); if (runId) await prisma.extractionRun.update({ where: { id: runId }, data: { status: "FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Extraction failed" } }).catch(() => undefined); return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal memproses PDF." }, { status: 500 }); }
}
