import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDocumentStorage } from "@/lib/platform/storage";
import {
  readJsonObject,
  requirePositiveInteger,
  requireString,
  uploadV2JsonError,
} from "@/lib/platform/uploads/upload-v2-http";
import {
  UploadV2Error,
  createUploadSession,
  uploadSessionView,
} from "@/lib/platform/uploads/upload-v2-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let createdSessionId: string | null = null;
  let initiatedMultipart: { objectKey: string; providerUploadId: string } | null = null;

  try {
    const body = await readJsonObject(request);
    const fileName = requireString(body.fileName, "fileName");
    const size = requirePositiveInteger(body.size, "size");
    const contentType = typeof body.contentType === "string" && body.contentType.trim()
      ? body.contentType.trim()
      : "application/pdf";

    const { session, resumeToken, plan, policy } = await createUploadSession({
      fileName,
      contentType,
      size,
    });
    createdSessionId = session.id;

    const storage = getDocumentStorage();
    if (plan.mode === "SINGLE_PUT") {
      const instruction = await storage.createSingleUpload({
        objectKey: session.objectKey,
        contentType: session.mimeType,
        contentLength: session.expectedSize,
        expiresInSeconds: policy.sessionTtlSeconds > 3600 ? 900 : policy.sessionTtlSeconds,
        metadata: {
          "upload-session-id": session.id,
          "correlation-id": session.correlationId,
        },
      });
      const updated = await prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: "UPLOADING" },
        include: { parts: true, document: true },
      });
      return NextResponse.json({
        ok: true,
        resumeToken,
        session: uploadSessionView(updated),
        plan: { ...plan, upload: instruction },
      }, { status: 201 });
    }

    const multipart = await storage.initiateMultipartUpload({
      objectKey: session.objectKey,
      contentType: session.mimeType,
      expiresInSeconds: policy.sessionTtlSeconds,
      metadata: {
        "upload-session-id": session.id,
        "correlation-id": session.correlationId,
      },
    });
    initiatedMultipart = {
      objectKey: session.objectKey,
      providerUploadId: multipart.providerUploadId,
    };

    const updated = await prisma.uploadSession.update({
      where: { id: session.id },
      data: {
        providerUploadId: multipart.providerUploadId,
        status: "UPLOADING",
      },
      include: { parts: true, document: true },
    });

    return NextResponse.json({
      ok: true,
      resumeToken,
      session: uploadSessionView(updated),
      plan,
    }, { status: 201 });
  } catch (error) {
    if (initiatedMultipart) {
      await getDocumentStorage().abortMultipartUpload(initiatedMultipart).catch((abortError) => {
        console.error("upload-v2-initiate-rollback-abort-failed", abortError);
      });
    }
    if (createdSessionId) {
      await prisma.uploadSession.updateMany({
        where: { id: createdSessionId, status: { in: ["INITIATED", "UPLOADING"] } },
        data: {
          status: "FAILED",
          errorCode: "INITIATE_FAILED",
          errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Upload initiation failed.",
        },
      }).catch((databaseError) => {
        console.error("upload-v2-initiate-rollback-db-failed", databaseError);
      });
    }
    if (error instanceof UploadV2Error) return uploadV2JsonError(error);
    return uploadV2JsonError(error);
  }
}
