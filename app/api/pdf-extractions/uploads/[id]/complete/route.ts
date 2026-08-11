import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAsyncJob, findAsyncJobByChecksum } from "@/lib/async-pdf-extraction";
import { resetFailedAsyncUpload } from "@/lib/async-pdf-upload-retry";
import { findDuplicatePdf } from "@/lib/pdf-upload-deduplication";
import { inspectPdfForOcr, sha256, validatePdfMagic } from "@/lib/pdf-extraction";
import { assertUploadSessionActive, expectedPartSize, partCount, verifyResumeToken } from "@/lib/resumable-pdf-upload";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = await prisma.uploadSession.findUnique({
      where: { id },
      include: { parts: { orderBy: { partNumber: "asc" } } },
    });
    if (!session) return NextResponse.json({ error: "Sesi upload tidak ditemukan." }, { status: 404 });
    if (!verifyResumeToken(request.headers.get("x-investai-resume-token"), session.resumeTokenHash)) {
      return NextResponse.json({ error: "Token resume upload tidak valid." }, { status: 401 });
    }
    if (["COMPLETED", "DUPLICATE"].includes(session.status)) {
      const alreadyAccepted = await findDuplicatePdf(session.checksum);
      if (alreadyAccepted) return NextResponse.json({ ok: true, ...alreadyAccepted });
      throw new Error("Upload sudah selesai, tetapi job tidak ditemukan. Periksa Financial Report Pipeline.");
    }
    assertUploadSessionActive(session);
    const totalParts = partCount(session.expectedSize, session.partSize ?? 0);
    if (session.parts.length !== totalParts) throw new Error(`Upload belum lengkap (${session.parts.length}/${totalParts} bagian).`);
    for (let index = 0; index < session.parts.length; index += 1) {
      const part = session.parts[index];
      const expectedNumber = index + 1;
      if (part.partNumber !== expectedNumber || part.size !== expectedPartSize(session.expectedSize, session.partSize ?? 0, expectedNumber) || !part.content) {
        throw new Error(`Bagian ${expectedNumber} belum lengkap atau rusak.`);
      }
    }
    const bytes = Buffer.concat(session.parts.map((part) => Buffer.from(part.content!)));
    if (bytes.length !== session.expectedSize || sha256(bytes) !== session.checksum) throw new Error("Checksum PDF tidak cocok. Upload tidak diproses.");
    validatePdfMagic(bytes);

    const duplicate = await findDuplicatePdf(session.checksum);
    if (duplicate) {
      await prisma.$transaction([
        prisma.uploadPart.deleteMany({ where: { uploadSessionId: session.id } }),
        prisma.uploadSession.update({ where: { id: session.id }, data: { status: "DUPLICATE", completedAt: new Date() } }),
      ]);
      return NextResponse.json({ ok: true, ...duplicate });
    }

    const existingFailedJob = await findAsyncJobByChecksum(session.checksum);
    const jobId = existingFailedJob?.id ?? randomUUID();
    const preflight = inspectPdfForOcr(bytes);
    if (existingFailedJob) {
      await resetFailedAsyncUpload({ id: jobId, fileName: session.originalFileName, mimeType: session.mimeType, fileSize: session.expectedSize, preflight, bytes });
    } else {
      await createAsyncJob({ id: jobId, fileName: session.originalFileName, mimeType: session.mimeType, fileSize: session.expectedSize, checksum: session.checksum, preflight, bytes });
    }
    await prisma.$transaction([
      prisma.uploadPart.deleteMany({ where: { uploadSessionId: session.id } }),
      prisma.uploadSession.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: new Date() } }),
    ]);
    return NextResponse.json({
      ok: true,
      accepted: true,
      jobId,
      status: "UPLOADED",
      message: "Upload lengkap dan job sudah tersimpan. AI akan memproses PDF di background; halaman boleh ditutup.",
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal menyelesaikan upload PDF." }, { status: 400 });
  }
}
