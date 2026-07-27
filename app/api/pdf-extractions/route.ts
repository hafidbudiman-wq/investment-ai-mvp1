import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inspectPdfForOcr, isUploadedPdfLike, sha256, validatePdfUpload } from "@/lib/pdf-extraction";
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
    const file = form.get("file");
    const confirmedCompanyId = String(form.get("confirmedCompanyId") ?? "");
    if (!isUploadedPdfLike(file)) return NextResponse.json({ error: "PDF belum dipilih atau upload tidak terbaca dengan benar." }, { status: 400 });
    validatePdfUpload(file);

    const bytes = Buffer.from(await file.arrayBuffer());
    const checksum = sha256(bytes);
    const preflight = inspectPdfForOcr(bytes);

    const [companies, accounts] = await Promise.all([
      prisma.company.findMany({ where: { isActive: true }, select: { id: true, ticker: true, name: true, currency: true } }),
      prisma.canonicalAccount.findMany({ where: { isActive: true, isCalculated: false }, select: { id: true, code: true, name: true, statementType: true, aliases: true }, orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }] }),
    ]);

    const extracted = await extractFinancialPdfWithOpenAI({
      bytes,
      fileName: file.name,
      knownCompanies: companies.map((company) => ({ ticker: company.ticker, name: company.name })),
      accounts,
      preflight,
    });

    const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const detectedTicker = normalize(extracted.detectedCompanyTicker);
    const detectedName = normalize(extracted.detectedCompanyName);
    const exactCompany = companies.find((item) => normalize(item.ticker) === detectedTicker)
      ?? companies.find((item) => normalize(item.name) === detectedName);
    const fuzzyCompany = exactCompany
      ?? companies.find((item) => detectedName && (normalize(item.name).includes(detectedName) || detectedName.includes(normalize(item.name))))
      ?? companies.find((item) => detectedTicker && normalize(item.ticker).includes(detectedTicker));
    const confirmedCompany = confirmedCompanyId ? companies.find((item) => item.id === confirmedCompanyId) : undefined;

    const companyConfidence = Math.max(0, Math.min(1, extracted.detectedCompanyConfidence ?? 0));
    let company = confirmedCompany ?? (companyConfidence >= 0.95 ? exactCompany : undefined);

    if (!company) {
      const needsConfirmation = Boolean(fuzzyCompany && companyConfidence >= 0.75);
      return NextResponse.json({
        ok: false,
        code: needsConfirmation ? "COMPANY_CONFIRMATION_REQUIRED" : "COMPANY_NOT_FOUND",
        detectedCompany: {
          ticker: extracted.detectedCompanyTicker,
          name: extracted.detectedCompanyName,
          confidence: companyConfidence,
        },
        suggestedCompany: fuzzyCompany ? { id: fuzzyCompany.id, ticker: fuzzyCompany.ticker, name: fuzzyCompany.name } : null,
        detectedPeriod: {
          periodType: extracted.detectedPeriodType,
          year: extracted.detectedYear,
          confidence: Math.max(0, Math.min(1, extracted.detectedPeriodConfidence ?? 0)),
        },
        detectedCurrency: extracted.detectedCurrency,
        message: needsConfirmation
          ? `AI mendeteksi ${extracted.detectedCompanyTicker ?? "?"} — ${extracted.detectedCompanyName ?? "?"}, tetapi kecocokan Company Master perlu konfirmasi.`
          : `AI mendeteksi ${extracted.detectedCompanyTicker ?? "?"} — ${extracted.detectedCompanyName ?? "?"}, tetapi emiten belum ada di Company Master. Review lalu tambahkan emiten untuk melanjutkan.`,
      }, { status: 422 });
    }

    if (!extracted.detectedYear || !extracted.detectedPeriodType || (extracted.detectedPeriodConfidence ?? 0) < 0.75) {
      return NextResponse.json({
        ok: false,
        code: "PERIOD_CONFIRMATION_REQUIRED",
        detectedCompany: { ticker: company.ticker, name: company.name, confidence: companyConfidence },
        detectedPeriod: { periodType: extracted.detectedPeriodType, year: extracted.detectedYear, confidence: Math.max(0, Math.min(1, extracted.detectedPeriodConfidence ?? 0)) },
        message: "AI belum cukup yakin menentukan periode laporan. Periode harus dikonfirmasi sebelum data masuk staging.",
      }, { status: 422 });
    }

    const existing = await prisma.extractionRun.findUnique({ where: { companyId_checksum: { companyId: company.id, checksum } }, include: { _count: { select: { chunks: true, candidates: true } } } });
    if (existing) return NextResponse.json({ ok: true, duplicate: true, run: existing, runId: existing.id, message: "PDF yang sama sudah pernah diproses. Tidak dibuat duplikat." });

    const run = await prisma.extractionRun.create({ data: { companyId: company.id, fileName: file.name, mimeType: file.type || "application/pdf", fileSize: file.size, checksum, year: extracted.detectedYear, periodType: extracted.detectedPeriodType, currency: extracted.detectedCurrency || company.currency, unitScale: extracted.detectedUnitScale || null, pageCount: extracted.pageCount, status: "PROCESSING", parserVersion: "mvp-1.2d-v4-company-review" } });
    runId = run.id;

    const accountByCode = new Map(accounts.map((account) => [account.code.toUpperCase(), account]));
    const chunks = extracted.chunks.length ? extracted.chunks : [{ section: "Financial Statements", chunkType: "SECTION" as const, pageStart: null, pageEnd: null, textSummary: "AI extraction result" }];

    await prisma.$transaction(async (tx) => {
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        await tx.extractionChunk.create({ data: { runId: run.id, ordinal: index + 1, chunkType: chunk.chunkType, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, section: chunk.section, text: chunk.textSummary.slice(0, 12000), textHash: sha256(Buffer.from(chunk.textSummary)), metadata: { processingMode: preflight.processingMode, preflightConfidence: preflight.confidence, preflightReason: preflight.reason } } });
      }
      for (const candidate of extracted.candidates) {
        if (candidate.numericValue === null || !Number.isFinite(candidate.numericValue)) continue;
        const canonical = candidate.canonicalCode ? accountByCode.get(candidate.canonicalCode.toUpperCase()) : undefined;
        const matchingChunk = chunks.findIndex((chunk) => candidate.sourcePage != null && chunk.pageStart != null && chunk.pageEnd != null && candidate.sourcePage >= chunk.pageStart && candidate.sourcePage <= chunk.pageEnd);
        const storedChunk = matchingChunk >= 0 ? await tx.extractionChunk.findUnique({ where: { runId_ordinal: { runId: run.id, ordinal: matchingChunk + 1 } }, select: { id: true } }) : null;
        await tx.extractionCandidate.create({ data: { runId: run.id, chunkId: storedChunk?.id ?? null, statementType: candidate.statementType, reportedLabel: candidate.reportedLabel.slice(0, 500), normalizedLabel: candidate.reportedLabel.trim().toLowerCase().slice(0, 500), rawValue: candidate.rawValue.slice(0, 250), numericValue: candidate.numericValue, currency: candidate.currency || extracted.detectedCurrency || company.currency, scale: candidate.scale || extracted.detectedUnitScale || 1, sourcePage: candidate.sourcePage, sourceText: candidate.sourceText?.slice(0, 2000) ?? null, canonicalAccountId: canonical?.id ?? null, extractionConfidence: Math.max(0, Math.min(1, candidate.extractionConfidence)), mappingConfidence: canonical ? Math.max(0, Math.min(1, candidate.mappingConfidence)) : 0, mappingMethod: canonical ? "AI" : null, status: "PENDING" } });
      }
      await tx.extractionRun.update({ where: { id: run.id }, data: { status: "PENDING_REVIEW" } });
    });

    return NextResponse.json({
      ok: true,
      duplicate: false,
      runId: run.id,
      candidateCount: extracted.candidates.length,
      chunkCount: chunks.length,
      detectedCompany: { ticker: company.ticker, name: company.name, confidence: companyConfidence },
      detectedPeriod: { periodType: extracted.detectedPeriodType, year: extracted.detectedYear, confidence: extracted.detectedPeriodConfidence },
      processingMode: preflight.processingMode,
      message: `AI mendeteksi ${company.ticker} · ${extracted.detectedPeriodType} ${extracted.detectedYear}. ${extracted.candidates.length} kandidat masuk staging dan menunggu review.`,
    });
  } catch (error) {
    console.error("pdf-extraction-upload-failed", error);
    if (runId) await prisma.extractionRun.update({ where: { id: runId }, data: { status: "FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Extraction failed" } }).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal memproses PDF." }, { status: 500 });
  }
}
