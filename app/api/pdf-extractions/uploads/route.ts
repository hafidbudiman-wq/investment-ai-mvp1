import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findDuplicatePdf } from "@/lib/pdf-upload-deduplication";
import {
  createResumeToken,
  DATABASE_UPLOAD_EXPIRY_MS,
  DATABASE_UPLOAD_PART_SIZE,
  hashResumeToken,
  partCount,
  validateResumableUploadMetadata,
  verifyResumeToken,
} from "@/lib/resumable-pdf-upload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const metadata = validateResumableUploadMetadata(body);
    const duplicate = await findDuplicatePdf(metadata.checksum);
    if (duplicate) return NextResponse.json({ ok: true, ...duplicate });

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY belum dikonfigurasi; PDF baru belum dapat diproses." }, { status: 503 });
    }

    await prisma.uploadSession.deleteMany({
      where: { expiresAt: { lt: new Date() }, status: { in: ["INITIATED", "UPLOADING"] } },
    });

    const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId : null;
    const requestedResumeToken = typeof body.resumeToken === "string" ? body.resumeToken : null;
    if (requestedSessionId) {
      const session = await prisma.uploadSession.findUnique({
        where: { id: requestedSessionId },
        include: { parts: { select: { partNumber: true, size: true }, orderBy: { partNumber: "asc" } } },
      });
      if (
        session
        && session.checksum === metadata.checksum
        && session.expectedSize === metadata.fileSize
        && session.expiresAt.getTime() > Date.now()
        && ["INITIATED", "UPLOADING"].includes(session.status)
        && verifyResumeToken(requestedResumeToken, session.resumeTokenHash)
      ) {
        return NextResponse.json({
          ok: true,
          duplicate: false,
          resumed: true,
          sessionId: session.id,
          resumeToken: requestedResumeToken,
          partSize: session.partSize,
          totalParts: partCount(session.expectedSize, session.partSize ?? DATABASE_UPLOAD_PART_SIZE),
          completedParts: session.parts.map((part) => part.partNumber),
          expiresAt: session.expiresAt.toISOString(),
        });
      }
    }

    const id = randomUUID();
    const resumeToken = createResumeToken();
    const session = await prisma.uploadSession.create({
      data: {
        id,
        correlationId: randomUUID(),
        uploadMode: "DATABASE_CHUNKED",
        status: "INITIATED",
        storageProvider: "POSTGRESQL",
        bucket: "investai-upload-parts",
        objectKey: `pending/${id}.pdf`,
        originalFileName: metadata.fileName,
        mimeType: metadata.mimeType,
        expectedSize: metadata.fileSize,
        checksum: metadata.checksum,
        partSize: DATABASE_UPLOAD_PART_SIZE,
        lastPartNumber: partCount(metadata.fileSize),
        resumeTokenHash: hashResumeToken(resumeToken),
        expiresAt: new Date(Date.now() + DATABASE_UPLOAD_EXPIRY_MS),
      },
    });
    return NextResponse.json({
      ok: true,
      duplicate: false,
      resumed: false,
      sessionId: session.id,
      resumeToken,
      partSize: session.partSize,
      totalParts: session.lastPartNumber,
      completedParts: [],
      expiresAt: session.expiresAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal menyiapkan upload PDF." }, { status: 400 });
  }
}
