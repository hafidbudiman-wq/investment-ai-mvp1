import { prisma } from "@/lib/prisma";
import { ensureAsyncExtractionTable } from "@/lib/async-pdf-extraction";

export async function resetFailedAsyncUpload(input: {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  preflight: unknown;
  bytes: Buffer;
}) {
  await ensureAsyncExtractionTable();
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "AsyncExtractionJob"
     SET "fileName"=$2,
         "mimeType"=$3,
         "fileSize"=$4,
         "status"='UPLOADED',
         "openAiResponseId"=NULL,
         "runId"=NULL,
         "detectedTicker"=NULL,
         "detectedCompanyName"=NULL,
         "detectedYear"=NULL,
         "detectedPeriodType"=NULL,
         "errorMessage"=NULL,
         "preflight"=$5::jsonb,
         "fileData"=$6,
         "updatedAt"=CURRENT_TIMESTAMP
     WHERE "id"=$1 AND "status"='FAILED'`,
    input.id,
    input.fileName,
    input.mimeType,
    input.fileSize,
    JSON.stringify(input.preflight),
    input.bytes,
  );
  if (updated !== 1) throw new Error("Job gagal tidak dapat di-reset karena statusnya sudah berubah.");
}
