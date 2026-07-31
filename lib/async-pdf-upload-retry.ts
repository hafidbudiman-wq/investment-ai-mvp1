import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

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
