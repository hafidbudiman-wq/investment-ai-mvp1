import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { EXTRACTION_PARSER_VERSION } from "@/lib/financial/parser-version";

export async function resetFailedAsyncUpload(input: {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  preflight: unknown;
  bytes: Buffer;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.asyncExtractionJob.findUnique({ where: { id: input.id }, select: { checksum: true } });
    if (!existing) return { count: 0 };
    const document = await tx.financialDocument.upsert({
      where: { objectKey: `sha256/${existing.checksum}.pdf` },
      update: { content: input.bytes, verifiedSize: input.fileSize, magicBytesVerified: true, status: "VERIFIED", verifiedAt: new Date() },
      create: { storageProvider: "POSTGRESQL", bucket: "investai-source-documents", objectKey: `sha256/${existing.checksum}.pdf`, originalFileName: input.fileName, mimeType: input.mimeType, verifiedSize: input.fileSize, sha256: existing.checksum, content: input.bytes, magicBytesVerified: true, status: "VERIFIED", verifiedAt: new Date() },
    });
    return tx.asyncExtractionJob.updateMany({
      where: { id: input.id, status: "FAILED" },
      data: {
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        status: "UPLOADED",
        openAiResponseId: null,
        runId: null,
        documentId: document.id,
        detectedTicker: null,
        detectedCompanyName: null,
        detectedYear: null,
        detectedPeriodType: null,
        errorMessage: null,
        preflight: input.preflight as Prisma.InputJsonValue,
        fileData: input.bytes,
      },
    });
  });
  if (updated.count !== 1) throw new Error("Job gagal tidak dapat di-reset karena statusnya sudah berubah.");
}

export async function resetUntouchedStaleRun(input: {
  runId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  preflight: unknown;
  bytes: Buffer;
}) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.extractionRun.findUnique({
      where: { id: input.runId },
      include: { candidates: { select: { status: true } }, asyncJob: { select: { id: true } } },
    });
    if (!run || run.parserVersion === EXTRACTION_PARSER_VERSION || run.status !== "PENDING_REVIEW") return false;
    if (!run.asyncJob || run.candidates.some((candidate) => candidate.status !== "PENDING")) return false;

    const document = await tx.financialDocument.findUnique({ where: { id: run.documentId ?? "" }, select: { id: true } });
    if (!document) throw new Error("Source document persisten tidak tersedia untuk reprocess.");

    await tx.asyncExtractionJob.update({
      where: { id: run.asyncJob.id },
      data: {
        runId: null,
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        status: "UPLOADED",
        openAiResponseId: null,
        detectedTicker: null,
        detectedCompanyName: null,
        detectedYear: null,
        detectedPeriodType: null,
        errorMessage: null,
        preflight: input.preflight as Prisma.InputJsonValue,
        fileData: input.bytes,
      },
    });
    await tx.financialDocument.update({
      where: { id: document.id },
      data: { content: input.bytes, verifiedSize: input.fileSize, magicBytesVerified: true, status: "VERIFIED", verifiedAt: new Date() },
    });
    await tx.extractionRun.delete({ where: { id: run.id } });
    return true;
  });
}
