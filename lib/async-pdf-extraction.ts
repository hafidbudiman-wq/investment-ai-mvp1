import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/pdf-extraction";
import { chunkNativePdf } from "@/lib/financial/pdf-native-text";
import type { AsyncExtractionJob as AsyncJob, Prisma } from "@prisma/client";
import {
  parseFinancialExtractionResponse,
  retrieveFinancialPdfBackground,
  submitFinancialPdfBackground,
} from "@/lib/openai-financial-extraction";

type AsyncJobSummary = Omit<AsyncJob, "fileData">;

const submittingJobs = new Set<string>();

export async function findAsyncJobByChecksum(checksum: string) {
  return prisma.asyncExtractionJob.findUnique({ where: { checksum } });
}

export async function createAsyncJob(input: { id: string; fileName: string; mimeType: string; fileSize: number; checksum: string; preflight: unknown; bytes: Buffer }) {
  await prisma.$transaction(async (tx) => {
    const document = await tx.financialDocument.upsert({
      where: { objectKey: `sha256/${input.checksum}.pdf` },
      update: { content: input.bytes, verifiedSize: input.fileSize, sha256: input.checksum, magicBytesVerified: true, status: "VERIFIED", verifiedAt: new Date() },
      create: { storageProvider: "POSTGRESQL", bucket: "investai-source-documents", objectKey: `sha256/${input.checksum}.pdf`, originalFileName: input.fileName, mimeType: input.mimeType, verifiedSize: input.fileSize, sha256: input.checksum, content: input.bytes, magicBytesVerified: true, status: "VERIFIED", verifiedAt: new Date() },
    });
    await tx.asyncExtractionJob.create({
      data: {
        id: input.id,
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        checksum: input.checksum,
        status: "UPLOADED",
        preflight: input.preflight as Prisma.InputJsonValue,
        fileData: input.bytes,
        documentId: document.id,
      },
    });
  });
}

export async function markAsyncJobSubmitted(id: string, responseId: string, status: string) {
  const normalizedStatus = status === "queued" || status === "in_progress" ? "PROCESSING" : status.toUpperCase();
  await prisma.asyncExtractionJob.update({ where: { id }, data: { openAiResponseId: responseId, status: normalizedStatus, fileData: null, errorMessage: null } });
}

export async function markAsyncJobFailed(id: string, message: string) {
  await prisma.asyncExtractionJob.update({ where: { id }, data: { status: "FAILED", errorMessage: message.slice(0, 2000) } });
}

export async function listAsyncJobs() {
  return prisma.asyncExtractionJob.findMany({ where: { runId: null }, orderBy: { updatedAt: "desc" }, take: 100, omit: { fileData: true } });
}

async function getAsyncJobWithFile(id: string) {
  return prisma.asyncExtractionJob.findUnique({ where: { id }, include: { document: { select: { content: true } } } });
}

export async function submitQueuedAsyncJob(id: string) {
  if (submittingJobs.has(id)) return;
  submittingJobs.add(id);
  try {
    const job = await getAsyncJobWithFile(id);
    if (!job || job.status !== "UPLOADED" || job.openAiResponseId) return;
    const sourceBytes = job.document?.content ?? job.fileData;
    if (!sourceBytes?.length) throw new Error("Source PDF persisten tidak tersedia untuk dikirim ke OpenAI.");

    const [companies, accounts] = await Promise.all([
      prisma.company.findMany({ where: { isActive: true }, select: { ticker: true, name: true } }),
      prisma.canonicalAccount.findMany({
        where: { isActive: true, isCalculated: false },
        select: { id: true, code: true, name: true, statementType: true, aliases: true },
        orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }],
      }),
    ]);

    const background = await submitFinancialPdfBackground({
      bytes: Buffer.from(sourceBytes),
      fileName: job.fileName,
      knownCompanies: companies,
      accounts,
      preflight: job.preflight as Parameters<typeof submitFinancialPdfBackground>[0]["preflight"],
    });
    await markAsyncJobSubmitted(job.id, background.id, background.status);
  } catch (error) {
    await markAsyncJobFailed(id, error instanceof Error ? error.message : "Gagal mengirim PDF ke OpenAI background extraction.");
  } finally {
    submittingJobs.delete(id);
  }
}

export async function kickQueuedAsyncExtractionJobs(limit = 2) {
  const queued = await prisma.asyncExtractionJob.findMany({ where: { status: "UPLOADED", openAiResponseId: null }, select: { id: true }, orderBy: { createdAt: "asc" }, take: limit });
  for (const job of queued) void submitQueuedAsyncJob(job.id);
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function finalizeJob(job: AsyncJobSummary) {
  if (!job.openAiResponseId) return;
  const response = await retrieveFinancialPdfBackground(job.openAiResponseId);
  if (response.status === "queued" || response.status === "in_progress") {
    await prisma.asyncExtractionJob.update({ where: { id: job.id }, data: { status: "PROCESSING" } });
    return;
  }
  if (response.status !== "completed") {
    const detail = response.error?.message || response.incomplete_details?.reason || `OpenAI background response ${response.status}`;
    await markAsyncJobFailed(job.id, detail);
    return;
  }

  const extracted = parseFinancialExtractionResponse(response);
  const [companies, accounts] = await Promise.all([
    prisma.company.findMany({ where: { isActive: true }, select: { id: true, ticker: true, name: true, currency: true } }),
    prisma.canonicalAccount.findMany({ where: { isActive: true, isCalculated: false }, select: { id: true, code: true, name: true, statementType: true }, orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }] }),
  ]);
  const detectedTicker = normalize(extracted.detectedCompanyTicker);
  const detectedName = normalize(extracted.detectedCompanyName);
  const company = companies.find((item) => normalize(item.ticker) === detectedTicker)
    ?? companies.find((item) => normalize(item.name) === detectedName);

  await prisma.asyncExtractionJob.update({ where: { id: job.id }, data: {
    detectedTicker: extracted.detectedCompanyTicker,
    detectedCompanyName: extracted.detectedCompanyName,
    detectedYear: extracted.detectedYear,
    detectedPeriodType: extracted.detectedPeriodType,
  } });

  if (!company || (extracted.detectedCompanyConfidence ?? 0) < 0.95) {
    await markAsyncJobFailed(job.id, `AI mendeteksi ${extracted.detectedCompanyTicker ?? "?"} — ${extracted.detectedCompanyName ?? "?"}, tetapi emiten belum cocok secara aman dengan Company Master.`);
    return;
  }
  if (!extracted.detectedYear || !extracted.detectedPeriodType || (extracted.detectedPeriodConfidence ?? 0) < 0.75) {
    await markAsyncJobFailed(job.id, "AI belum cukup yakin menentukan periode laporan. Periode perlu dikonfirmasi sebelum staging dibuat.");
    return;
  }

  const existing = await prisma.extractionRun.findUnique({ where: { companyId_checksum: { companyId: company.id, checksum: job.checksum } } });
  if (existing) {
    await prisma.asyncExtractionJob.update({ where: { id: job.id }, data: { status: "COMPLETED", runId: existing.id, fileData: null } });
    return;
  }

  const accountByCode = new Map(accounts.map((account) => [account.code.toUpperCase(), account]));
  const document = job.documentId
    ? await prisma.financialDocument.findUnique({ where: { id: job.documentId }, select: { content: true } })
    : null;
  let nativeChunks: ReturnType<typeof chunkNativePdf> = [];
  if (document?.content?.length && preflightMode(job.preflight) !== "VISION_OCR_FALLBACK") {
    try {
      nativeChunks = chunkNativePdf(Buffer.from(document.content)).filter((chunk) => chunk.sourceText.trim()).slice(0, 80);
    } catch (error) {
      console.warn("native-pdf-chunking-fallback", { jobId: job.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const chunks = nativeChunks.length
    ? nativeChunks.map((chunk) => ({ section: chunk.statementType, chunkType: chunk.chunkType, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, textSummary: chunk.sourceText }))
    : extracted.chunks.length
      ? extracted.chunks
      : [{ section: "Financial Statements", chunkType: "SECTION" as const, pageStart: null, pageEnd: null, textSummary: "AI extraction result" }];
  const preflight = (job.preflight ?? {}) as { processingMode?: string; confidence?: number; reason?: string };

  const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.extractionRun.create({ data: {
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
      parserVersion: "mvp-1.2d-v6-ack-first-background",
      documentId: job.documentId,
    } });
    const chunkIds = new Map<number, string>();
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const stored = await tx.extractionChunk.create({ data: {
        runId: run.id,
        ordinal: index + 1,
        chunkType: chunk.chunkType,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        section: chunk.section,
        text: chunk.textSummary.slice(0, 12000),
        textHash: sha256(Buffer.from(chunk.textSummary)),
        metadata: {
          statementType: chunk.section,
          companyId: company.id,
          reportingYear: extracted.detectedYear,
          reportingPeriod: extracted.detectedPeriodType,
          currency: extracted.detectedCurrency || company.currency,
          unitScale: extracted.detectedUnitScale,
          extractionMethod: preflight.processingMode,
          extractionConfidence: preflight.confidence,
          preflightReason: preflight.reason,
          openAiResponseId: job.openAiResponseId,
          traceReference: `${job.checksum}:${chunk.pageStart ?? "?"}-${chunk.pageEnd ?? "?"}:${index + 1}`,
        },
      } });
      chunkIds.set(index, stored.id);
    }
    for (const candidate of extracted.candidates) {
      if (candidate.numericValue === null || !Number.isFinite(candidate.numericValue)) continue;
      const canonical = candidate.canonicalCode ? accountByCode.get(candidate.canonicalCode.toUpperCase()) : undefined;
      const matchingChunk = chunks.findIndex((chunk) => candidate.sourcePage != null && chunk.pageStart != null && chunk.pageEnd != null && candidate.sourcePage >= chunk.pageStart && candidate.sourcePage <= chunk.pageEnd);
      await tx.extractionCandidate.create({ data: {
        runId: run.id,
        chunkId: matchingChunk >= 0 ? chunkIds.get(matchingChunk) ?? null : null,
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
      } });
    }
    await tx.extractionRun.update({ where: { id: run.id }, data: { status: "PENDING_REVIEW" } });
    return run.id;
  });
  await prisma.asyncExtractionJob.update({ where: { id: job.id }, data: { status: "COMPLETED", runId, fileData: null } });
}

function preflightMode(value: unknown): string | undefined {
  return value && typeof value === "object" && "processingMode" in value
    ? String((value as { processingMode?: unknown }).processingMode)
    : undefined;
}

export async function pollAsyncExtractionJobs(limit = 3) {
  const jobs = (await listAsyncJobs()).filter((job) => job.status === "PROCESSING").slice(0, limit);
  for (const job of jobs) {
    try {
      await finalizeJob(job);
    } catch (error) {
      await markAsyncJobFailed(job.id, error instanceof Error ? error.message : "Background extraction gagal.");
    }
  }
}
