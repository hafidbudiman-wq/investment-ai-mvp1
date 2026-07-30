import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDocumentStorage } from "@/lib/platform/storage";
import { uploadV2JsonError } from "@/lib/platform/uploads/upload-v2-http";
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

    if (session.status === "ABORTED") {
      return NextResponse.json({ ok: true, idempotent: true, session: uploadSessionView(session) });
    }
    if (["UPLOADED", "VERIFIED"].includes(session.status) || session.document) {
      throw new UploadV2Error(
        "Dokumen yang sudah selesai tidak dapat dibatalkan melalui upload session.",
        409,
        "UPLOAD_ALREADY_COMPLETED",
      );
    }

    const changed = await prisma.uploadSession.updateMany({
      where: { id, status: { in: ["INITIATED", "UPLOADING", "FAILED"] } },
      data: {
        status: "ABORTED",
        completedAt: new Date(),
        errorCode: "USER_ABORTED",
        errorMessage: "Upload dibatalkan oleh pengguna.",
      },
    });
    if (changed.count !== 1) {
      throw new UploadV2Error(
        `Upload tidak dapat dibatalkan pada status ${session.status}.`,
        409,
        "UPLOAD_ABORT_CONFLICT",
      );
    }

    const storage = getDocumentStorage();
    let cleanupWarning: string | null = null;
    try {
      if (session.uploadMode === "MULTIPART" && session.providerUploadId) {
        await storage.abortMultipartUpload({
          objectKey: session.objectKey,
          providerUploadId: session.providerUploadId,
        });
      } else {
        await storage.deleteObject({ objectKey: session.objectKey });
      }
    } catch (error) {
      cleanupWarning = "Session sudah dibatalkan, tetapi object storage perlu dibersihkan oleh cleanup job.";
      console.error("upload-v2-abort-storage-cleanup-failed", error);
    }

    await prisma.uploadPart.deleteMany({ where: { uploadSessionId: id } });
    const updated = await prisma.uploadSession.findUniqueOrThrow({
      where: { id },
      include: { parts: true, document: true },
    });
    return NextResponse.json({
      ok: true,
      idempotent: false,
      cleanupWarning,
      session: uploadSessionView(updated),
    });
  } catch (error) {
    return uploadV2JsonError(error);
  }
}
