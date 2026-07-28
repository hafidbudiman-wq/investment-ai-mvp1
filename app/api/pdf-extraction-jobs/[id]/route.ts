import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findJobById, updateAsyncJob } from "@/lib/async-extraction-jobs";
import { parseFinancialExtractionResponse, retrieveFinancialPdfBackground } from "@/lib/openai-financial-extraction";
import { sha256 } from "@/lib/pdf-extraction";

export const runtime = "nodejs";
export const maxDuration = 60;

const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const job = await findJobById(id);
    if (!job) return NextResponse.json({ error: "Background extraction job tidak ditemukan." }, { status: 404 });
    if (job.runId) return NextResponse.json({ ok: true, jobId: job.id, status: "PENDING_REVIEW", runId: job.runId, message: "AI extraction selesai dan menunggu human review." });
    if (job.status === "FAILED") return NextResponse.json({ ok: false, jobId: job.id, status: "FAILED", error: job.errorMessage || "Background extraction gagal." }, { status: 422 });
    if (!job.openAiResponseId) return NextResponse.json({ ok: true, jobId: job.id, status: job.status, message: "Job menunggu pengiriman ke AI." });

    const response = await retrieveFinancialPdfBackground(job.openAiResponseId);
    if (response.status === "queued" || response.status === "in_progress") {
      await updateAsyncJob(job.id, { status: "PROCESSING" });
      return NextResponse.json({ ok: true, jobId: job.id, status: "PROCESSING", message: `OpenAI background response: ${response.status}.` });
    }
    if (response.status !== "completed") {
      const reason = response.error?.message || response.incomplete_details?.reason || `OpenAI background response berakhir dengan status ${response.status}.`;
      await updateAsyncJob(job.id, { status: "FAILED", errorMessage: reason.slice(0, 2000) });
      return NextResponse.json({ ok: false, jobId: job.id, status: "FAILED", error: reason }, { status: 422 });
    }

    const extracted = parseFinancialExtractionResponse(response);
    const [companies, accounts] = await Promise.all([
      prisma.company.findMany({ where: { isActive: true }, select: { id: true, ticker: true, name: true, currency: true } }),
      prisma.canonicalAccount.findMany({ where: { isActive: true, isCalculated: false }, select: { id: true, code: true, name: true, statementType: true, aliases: true }, orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }] }),
    ]);

    const detectedTicker = normalize(extracted.detectedCompanyTicker);
    const detectedName = normalize(extracted.detectedCompanyName);
    const exactCompany = companies.find((item) => normalize(item.ticker) === detectedTicker)
      ?? companies.find((item) => normalize(item.name) === detectedName);
    const fuzzyCompany = exactCompany
      ?? companies.find((item) => detectedName && (normalize(item.name).includes(detectedName) || detectedName.includes(normalize(item.name))))
      ?? companies.find((item) => detectedTicker && normalize(item.ticker).includes(detectedTicker));
    const confirmedCompany = job.confirmedCompanyId ? companies.find((item) => item.id === job.confirmedCompanyId) : undefined;
    const companyConfidence = Math.max(0, Math.min(1, extracted.detectedCompanyConfidence ?? 0));
    const company = confirmedCompany ?? (companyConfidence >= 0.95 ? exactCompany : undefined);

    if (!company) {
      const suggestion = fuzzyCompany ? `${fuzzyCompany.ticker} — ${fuzzyCompany.name}` : "tidak ada";
      const error = `AI mendeteksi ${extracted.detectedCompanyTicker ?? "?"} — ${extracted.detectedCompanyName ?? "?"} (confidence ${Math.round(companyConfidence * 100)}%), tetapi Company Master belum dapat dikonfirmasi. Kandidat terdekat: ${suggestion}.`;
      await updateAsyncJob(job.id, { status: "FAILED", errorMessage: error });
      return NextResponse.json({ ok: false, jobId: job.id, status: "FAILED", code: "COMPANY_CONFIRMATION_REQUIRED", error }, { status: 422 });
    }

    if (!extracted.detectedYear || !extracted.detectedPeriodType || (extracted.detectedPeriodConfidence ?? 0) < 0.75) {
      const error = `AI belum cukup yakin menentukan periode laporan: ${extracted.detectedPeriodType ?? "?"} ${extracted.detectedYear ?? "?"}.`;
      await updateAsyncJob(job.id, { status: "FAILED", errorMessage: error });
      return NextResponse.json({ ok: false, jobId: job.id, status: "FAILED", code: "PERIOD_CONFIRMATION_REQUIRED", error }, { status: 422 });
    }

    const existing = await prisma.extractionRun.findUnique({ where: { companyId_checksum: { companyId: company.id, checksum: job.checksum } } });
    if (existing) {
      await updateAsyncJob(job.id, { status: "PENDING_REVIEW", runId: existing.id, errorMessage: null });
      return NextResponse.json({ ok: true, jobId: job.id, status: existing.status, runId: existing.id, duplicate: true, message: "Hasil extraction yang sama sudah tersedia." });
    }

    const run = await prisma.extractionRun.create({
      data: {
        companyId: company.id,
        fileName: job.fileName,
        mimeType: job.mimeType,
        fileSize: job.fileSize,
        checksum: job.checksum,
        year: extracted.detectedYear,
        periodType: extracted.detectedPeriodType,
        currency: extracted.detectedCurrency || company.currency,
        unitScale: extracted.detectedUnitScale || null,
        pageCount: extracted.pageCount,
        status: "PROCESSING",
        parserVersion: "mvp-1.2d-v5-background",
      },
    });

    const accountByCode = new Map(accounts.map((account) => [account.code.toUpperCase(), account]));
    const chunks = extracted.chunks.length ? extracted.chunks : [{ section: "Financial Statements", chunkType: "SECTION" as const, pageStart: null, pageEnd: null, textSummary: "AI extraction result" }];
    const preflight = job.preflight ?? {};

    await prisma.$transaction(async (tx) => {
      const storedChunks = new Map<number, string>();
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        const stored = await tx.extractionChunk.create({
          data: {
            runId: run.id,
            ordinal: index + 1,
            chunkType: chunk.chunkType,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            section: chunk.section,
            text: chunk.textSummary.slice(0, 12000),
            textHash: sha256(Buffer.from(chunk.textSummary)),
            metadata: { processingMode: preflight.processingMode, preflightConfidence: preflight.confidence, preflightReason: preflight.reason, openAiResponseId: job.openAiResponseId },
          },
        });
        storedChunks.set(index, stored.id);
      }

      for (const candidate of extracted.candidates) {
        if (candidate.numericValue === null || !Number.isFinite(candidate.numericValue)) continue;
        const canonical = candidate.canonicalCode ? accountByCode.get(candidate.canonicalCode.toUpperCase()) : undefined;
        const matchingChunk = chunks.findIndex((chunk) => candidate.sourcePage != null && chunk.pageStart != null && chunk.pageEnd != null && candidate.sourcePage >= chunk.pageStart && candidate.sourcePage <= chunk.pageEnd);
        await tx.extractionCandidate.create({
          data: {
            runId: run.id,
            chunkId: matchingChunk >= 0 ? storedChunks.get(matchingChunk) ?? null : null,
            statementType: candidate.statementType,
            reportedLabel: candidate.reportedLabel.slice(0, 500),
            normalizedLabel: candidate.reportedLabel.trim().toLowerCase().slice(0, 500),
            rawValue: candidate.rawValue.slice(0, 250),
            numericValue: candidate.numericValue,
            currency: candidate.currency || extracted.detectedCurrency || company.currency,
            scale: candidate.scale || extracted.detectedUnitScale || 1,
            sourcePage: candidate.sourcePage,
            sourceText: candidate.sourceText?.slice(0, 2000) ?? null,
            canonicalAccountId: canonical?.id ?? null,
            extractionConfidence: Math.max(0, Math.min(1, candidate.extractionConfidence)),
            mappingConfidence: canonical ? Math.max(0, Math.min(1, candidate.mappingConfidence)) : 0,
            mappingMethod: canonical ? "AI" : null,
            status: "PENDING",
          },
        });
      }
      await tx.extractionRun.update({ where: { id: run.id }, data: { status: "PENDING_REVIEW" } });
    });

    await updateAsyncJob(job.id, { status: "PENDING_REVIEW", runId: run.id, errorMessage: null });
    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: "PENDING_REVIEW",
      runId: run.id,
      candidateCount: extracted.candidates.length,
      message: `AI selesai membaca ${company.ticker} ${extracted.detectedPeriodType} ${extracted.detectedYear}. Hasil siap direview.`,
    });
  } catch (error) {
    console.error("async-extraction-poll-failed", error);
    const message = error instanceof Error ? error.message : "Gagal menyelesaikan background extraction.";
    await updateAsyncJob(id, { status: "FAILED", errorMessage: message.slice(0, 2000) }).catch(() => undefined);
    return NextResponse.json({ ok: false, jobId: id, status: "FAILED", error: message }, { status: 500 });
  }
}
