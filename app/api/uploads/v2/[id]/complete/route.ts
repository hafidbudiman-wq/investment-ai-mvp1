import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDocumentStorage } from "@/lib/platform/storage";
import { uploadV2JsonError } from "@/lib/platform/uploads/upload-v2-http";
import { expectedPartSize, normalizeEtag } from "@/lib/platform/uploads/upload-v2-policy";
import {
  UploadV2Error,
  assertUploadV2Enabled,
  requireUploadSession,
  uploadSessionView,
} from "@/lib/platform/uploads/upload-v2-session";

export const runtime = "nodejs";

async function objectAlreadyComplete(objectKey: string, expectedSize: number) {
  try {
    const head = await getDocumentStorage().headObject({ objectKey });
    if (head.contentLength !== expectedSize) {
      throw new UploadV2Error(
        "Ukuran object di Bucket tidak sesuai dengan PDF yang diinisiasi.",
        409,
        "OBJECT_SIZE_MISMATCH",
      );
    }
    return head;
  } catch (error) {
    if (error instanceof UploadV2Error) throw error;
    return null;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let ownsCompletionLock = false;
  try {
    assertUploadV2Enabled();
    const { id } = await context.params;
    const session = await requireUploadSession(request, id);

    if (session.document && ["UPLOADED", "VERIFYING", "VERIFIED"].includes(session.status)) {
      return NextResponse.json({
        ok: true,
        idempotent: true,
        document: { id: session.document.id, status: session.document.status },
        session: uploadSessionView(session),
      });
    }
    if (["ABORTED", "FAILED"].includes(session.status)) {
      throw new UploadV2Error(
        `Upload tidak dapat diselesaikan pada status ${session.status}.`,
        409,
        "UPLOAD_SESSION_NOT_ACTIVE",
      );
    }

    const locked = await prisma.uploadSession.updateMany({
      where: { id, status: { in: ["INITIATED", "UPLOADING"] }, document: null },
      data: { status: "VERIFYING", errorCode: null, errorMessage: null },
    });
    if (locked.count !== 1) {
      throw new UploadV2Error(
        "Upload sedang diselesaikan oleh request lain. Coba cek status kembali.",
        409,
        "UPLOAD_COMPLETION_IN_PROGRESS",
      );
    }
    ownsCompletionLock = true;

    const storage = getDocumentStorage();
    let head = await objectAlreadyComplete(session.objectKey, session.expectedSize);

    if (!head && session.uploadMode === "MULTIPART") {
      if (!session.providerUploadId || !session.partSize) {
        throw new UploadV2Error("Multipart session tidak lengkap.", 500, "INVALID_UPLOAD_SESSION");
      }
      const providerParts = await storage.listMultipartParts({
        objectKey: session.objectKey,
        providerUploadId: session.providerUploadId,
      });
      const expectedCount = Math.ceil(session.expectedSize / session.partSize);
      if (providerParts.length !== expectedCount) {
        throw new UploadV2Error(
          `Multipart upload belum lengkap (${providerParts.length}/${expectedCount} part).`,
          409,
          "MULTIPART_INCOMPLETE",
        );
      }
      const completedParts = providerParts
        .sort((left, right) => left.partNumber - right.partNumber)
        .map((part, index) => {
          const expectedNumber = index + 1;
          if (part.partNumber !== expectedNumber || !part.size) {
            throw new UploadV2Error(
              "Urutan atau ukuran multipart di Bucket tidak valid.",
              409,
              "MULTIPART_INVALID",
            );
          }
          const expectedSize = expectedPartSize({
            expectedSize: session.expectedSize,
            partSize: session.partSize!,
            partNumber: part.partNumber,
          });
          if (part.size !== expectedSize) {
            throw new UploadV2Error(
              `Ukuran part ${part.partNumber} tidak sesuai.`,
              409,
              "PART_SIZE_MISMATCH",
            );
          }
          return {
            partNumber: part.partNumber,
            etag: normalizeEtag(part.etag),
            size: part.size,
          };
        });

      head = await storage.completeMultipartUpload({
        objectKey: session.objectKey,
        providerUploadId: session.providerUploadId,
        parts: completedParts,
      });
      if (head.contentLength !== session.expectedSize) {
        throw new UploadV2Error(
          "Ukuran PDF setelah multipart completion tidak sesuai.",
          409,
          "OBJECT_SIZE_MISMATCH",
        );
      }

      await prisma.$transaction(async (tx) => {
        await tx.uploadPart.deleteMany({ where: { uploadSessionId: id } });
        await tx.uploadPart.createMany({
          data: completedParts.map((part) => ({ uploadSessionId: id, ...part })),
        });
      });
    }

    if (!head) {
      throw new UploadV2Error(
        "PDF belum ditemukan di Bucket. Selesaikan transfer terlebih dahulu.",
        409,
        "OBJECT_NOT_FOUND",
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingDocument = await tx.financialDocument.findUnique({
        where: { uploadSessionId: id },
      });
      const document = existingDocument ?? await tx.financialDocument.create({
        data: {
          uploadSessionId: id,
          storageProvider: session.storageProvider,
          bucket: session.bucket,
          objectKey: session.objectKey,
          originalFileName: session.originalFileName,
          mimeType: session.mimeType,
          verifiedSize: head!.contentLength,
          status: "UPLOADED",
        },
      });

      await tx.job.upsert({
        where: { id: `verify-${document.id}` },
        create: {
          id: `verify-${document.id}`,
          correlationId: session.correlationId,
          type: "DOCUMENT_VERIFY",
          status: "QUEUED",
          documentId: document.id,
          deduplicationKey: `document-verify:${document.id}:v1`,
          payload: {
            documentId: document.id,
            objectKey: session.objectKey,
            expectedSize: session.expectedSize,
            contentType: session.mimeType,
          },
        },
        update: {},
      });

      const updatedSession = await tx.uploadSession.update({
        where: { id },
        data: {
          status: "UPLOADED",
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
        include: { parts: { orderBy: { partNumber: "asc" } }, document: true },
      });
      return { document, updatedSession };
    });

    return NextResponse.json({
      ok: true,
      idempotent: false,
      document: { id: result.document.id, status: result.document.status },
      session: uploadSessionView(result.updatedSession),
      message: "PDF tersimpan. Verifikasi dokumen sudah masuk antrean worker.",
    }, { status: 201 });
  } catch (error) {
    if (ownsCompletionLock) {
      const { id } = await context.params;
      await prisma.uploadSession.updateMany({
        where: { id, status: "VERIFYING", document: null },
        data: {
          status: "UPLOADING",
          errorCode: error instanceof UploadV2Error ? error.code : "COMPLETE_FAILED",
          errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Upload completion failed.",
        },
      }).catch((databaseError) => {
        console.error("upload-v2-complete-unlock-failed", databaseError);
      });
    }
    return uploadV2JsonError(error);
  }
}
