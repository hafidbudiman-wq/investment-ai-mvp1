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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertUploadV2Enabled();
    const { id } = await context.params;
    const session = await requireUploadSession(request, id);

    if (["ABORTED", "FAILED"].includes(session.status)) {
      throw new UploadV2Error(
        `Upload tidak dapat direconcile pada status ${session.status}.`,
        409,
        "UPLOAD_SESSION_NOT_ACTIVE",
      );
    }

    const storage = getDocumentStorage();
    if (session.uploadMode === "SINGLE_PUT") {
      try {
        const head = await storage.headObject({ objectKey: session.objectKey });
        if (head.contentLength !== session.expectedSize) {
          throw new UploadV2Error(
            "Ukuran object di Bucket belum sesuai dengan ukuran PDF.",
            409,
            "OBJECT_SIZE_MISMATCH",
          );
        }
        const refreshed = await prisma.uploadSession.update({
          where: { id },
          data: { status: "UPLOADING", errorCode: null, errorMessage: null },
          include: { parts: true, document: true },
        });
        return NextResponse.json({
          ok: true,
          objectPresent: true,
          missingParts: [],
          session: uploadSessionView(refreshed),
        });
      } catch (error) {
        if (error instanceof UploadV2Error) throw error;
        return NextResponse.json({
          ok: true,
          objectPresent: false,
          missingParts: [1],
          session: uploadSessionView(session),
        });
      }
    }

    if (!session.providerUploadId || !session.partSize) {
      throw new UploadV2Error("Multipart session tidak lengkap.", 500, "INVALID_UPLOAD_SESSION");
    }

    const providerParts = await storage.listMultipartParts({
      objectKey: session.objectKey,
      providerUploadId: session.providerUploadId,
    });
    const expectedPartCount = Math.ceil(session.expectedSize / session.partSize);
    const authoritative = providerParts.map((part) => {
      if (!part.size) {
        throw new UploadV2Error(
          `Bucket tidak memberikan ukuran part ${part.partNumber}.`,
          502,
          "STORAGE_PART_SIZE_MISSING",
        );
      }
      const expectedSize = expectedPartSize({
        expectedSize: session.expectedSize,
        partSize: session.partSize!,
        partNumber: part.partNumber,
      });
      if (part.size !== expectedSize) {
        throw new UploadV2Error(
          `Part ${part.partNumber} di Bucket memiliki ukuran yang tidak sesuai.`,
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

    await prisma.$transaction(async (tx) => {
      const providerNumbers = authoritative.map((part) => part.partNumber);
      await tx.uploadPart.deleteMany({
        where: {
          uploadSessionId: id,
          ...(providerNumbers.length ? { partNumber: { notIn: providerNumbers } } : {}),
        },
      });
      for (const part of authoritative) {
        await tx.uploadPart.upsert({
          where: {
            uploadSessionId_partNumber: {
              uploadSessionId: id,
              partNumber: part.partNumber,
            },
          },
          create: { uploadSessionId: id, ...part },
          update: { etag: part.etag, size: part.size, completedAt: new Date() },
        });
      }
      await tx.uploadSession.update({
        where: { id },
        data: {
          status: "UPLOADING",
          lastPartNumber: authoritative.at(-1)?.partNumber ?? null,
          errorCode: null,
          errorMessage: null,
        },
      });
    });

    const completedNumbers = new Set(authoritative.map((part) => part.partNumber));
    const missingParts = Array.from({ length: expectedPartCount }, (_, index) => index + 1)
      .filter((partNumber) => !completedNumbers.has(partNumber));
    const refreshed = await prisma.uploadSession.findUniqueOrThrow({
      where: { id },
      include: { parts: { orderBy: { partNumber: "asc" } }, document: true },
    });

    return NextResponse.json({
      ok: true,
      objectPresent: false,
      missingParts,
      session: uploadSessionView(refreshed),
    });
  } catch (error) {
    return uploadV2JsonError(error);
  }
}
