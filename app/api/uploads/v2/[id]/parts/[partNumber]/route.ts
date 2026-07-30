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
  expectedPartSize,
  getUploadV2Policy,
  normalizeEtag,
} from "@/lib/platform/uploads/upload-v2-policy";
import {
  UploadV2Error,
  assertUploadV2Enabled,
  requireUploadSession,
  uploadSessionView,
} from "@/lib/platform/uploads/upload-v2-session";

export const runtime = "nodejs";

function parsePartNumber(value: string): number {
  const partNumber = Number(value);
  if (!Number.isSafeInteger(partNumber) || partNumber <= 0) {
    throw new UploadV2Error("Nomor multipart tidak valid.", 400, "INVALID_PART_NUMBER");
  }
  return partNumber;
}

function assertMultipartSession(session: {
  uploadMode: string;
  status: string;
  providerUploadId: string | null;
}) {
  if (session.uploadMode !== "MULTIPART" || !session.providerUploadId) {
    throw new UploadV2Error("Session ini bukan multipart upload.", 409, "NOT_MULTIPART_UPLOAD");
  }
  if (!["INITIATED", "UPLOADING"].includes(session.status)) {
    throw new UploadV2Error(
      `Multipart part tidak dapat diubah pada status ${session.status}.`,
      409,
      "UPLOAD_SESSION_NOT_ACTIVE",
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; partNumber: string }> },
) {
  try {
    assertUploadV2Enabled();
    const { id, partNumber: rawPartNumber } = await context.params;
    const partNumber = parsePartNumber(rawPartNumber);
    const session = await requireUploadSession(request, id);
    assertMultipartSession(session);
    const partSize = session.partSize;
    if (!partSize) throw new UploadV2Error("Multipart part size tidak tersedia.", 500, "INVALID_UPLOAD_PLAN");
    const expectedSize = expectedPartSize({
      expectedSize: session.expectedSize,
      partSize,
      partNumber,
    });
    const policy = getUploadV2Policy();
    const instruction = await getDocumentStorage().presignMultipartPart({
      objectKey: session.objectKey,
      providerUploadId: session.providerUploadId!,
      partNumber,
      expiresInSeconds: Math.min(900, policy.sessionTtlSeconds),
    });
    return NextResponse.json({ ok: true, expectedSize, upload: instruction });
  } catch (error) {
    return uploadV2JsonError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; partNumber: string }> },
) {
  try {
    assertUploadV2Enabled();
    const { id, partNumber: rawPartNumber } = await context.params;
    const partNumber = parsePartNumber(rawPartNumber);
    const session = await requireUploadSession(request, id);
    assertMultipartSession(session);
    const body = await readJsonObject(request);
    const etag = normalizeEtag(requireString(body.etag, "etag"));
    const size = requirePositiveInteger(body.size, "size");
    const partSize = session.partSize;
    if (!partSize) throw new UploadV2Error("Multipart part size tidak tersedia.", 500, "INVALID_UPLOAD_PLAN");
    const expectedSize = expectedPartSize({
      expectedSize: session.expectedSize,
      partSize,
      partNumber,
    });
    if (size !== expectedSize) {
      throw new UploadV2Error(
        `Ukuran part ${partNumber} tidak sesuai upload plan.`,
        409,
        "PART_SIZE_MISMATCH",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.uploadPart.upsert({
        where: { uploadSessionId_partNumber: { uploadSessionId: id, partNumber } },
        create: { uploadSessionId: id, partNumber, etag, size },
        update: { etag, size, completedAt: new Date() },
      });
      await tx.uploadSession.update({
        where: { id },
        data: {
          status: "UPLOADING",
          lastPartNumber: partNumber,
          errorCode: null,
          errorMessage: null,
        },
      });
    });

    const updated = await prisma.uploadSession.findUniqueOrThrow({
      where: { id },
      include: { parts: { orderBy: { partNumber: "asc" } }, document: true },
    });
    return NextResponse.json({ ok: true, session: uploadSessionView(updated) });
  } catch (error) {
    return uploadV2JsonError(error);
  }
}
