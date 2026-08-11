import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/pdf-extraction";
import { assertUploadSessionActive, expectedPartSize, verifyResumeToken } from "@/lib/resumable-pdf-upload";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string; partNumber: string }> }) {
  try {
    const { id, partNumber: rawPartNumber } = await context.params;
    const partNumber = Number(rawPartNumber);
    const session = await prisma.uploadSession.findUnique({ where: { id } });
    if (!session) return NextResponse.json({ error: "Sesi upload tidak ditemukan." }, { status: 404 });
    if (!verifyResumeToken(request.headers.get("x-investai-resume-token"), session.resumeTokenHash)) {
      return NextResponse.json({ error: "Token resume upload tidak valid." }, { status: 401 });
    }
    assertUploadSessionActive(session);
    const expectedSize = expectedPartSize(session.expectedSize, session.partSize ?? 0, partNumber);
    const declaredSize = request.headers.get("content-length");
    if (declaredSize && Number(declaredSize) !== expectedSize) {
      return NextResponse.json({ error: `Ukuran bagian ${partNumber} tidak sesuai.` }, { status: 400 });
    }
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length !== expectedSize) {
      return NextResponse.json({ error: `Ukuran bagian ${partNumber} tidak sesuai (${bytes.length}/${expectedSize}).` }, { status: 400 });
    }
    const etag = sha256(bytes);
    await prisma.$transaction([
      prisma.uploadPart.upsert({
        where: { uploadSessionId_partNumber: { uploadSessionId: session.id, partNumber } },
        update: { etag, size: bytes.length, content: bytes, completedAt: new Date() },
        create: { uploadSessionId: session.id, partNumber, etag, size: bytes.length, content: bytes },
      }),
      prisma.uploadSession.update({ where: { id: session.id }, data: { status: "UPLOADING" } }),
    ]);
    return NextResponse.json({ ok: true, partNumber, etag, size: bytes.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal menyimpan bagian PDF." }, { status: 400 });
  }
}
