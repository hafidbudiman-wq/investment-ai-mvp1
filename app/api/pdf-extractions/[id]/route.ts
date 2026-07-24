import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const run = await prisma.extractionRun.findUnique({
      where: { id },
      include: {
        company: { select: { ticker: true, name: true } },
        chunks: { orderBy: { ordinal: "asc" }, select: { id: true, ordinal: true, chunkType: true, pageStart: true, pageEnd: true, section: true } },
        candidates: {
          orderBy: [{ sourcePage: "asc" }, { createdAt: "asc" }],
          include: { canonicalAccount: { select: { id: true, code: true, name: true, statementType: true } } },
        },
      },
    });
    if (!run) return NextResponse.json({ error: "Extraction run tidak ditemukan." }, { status: 404 });
    const accounts = await prisma.canonicalAccount.findMany({
      where: { isActive: true, isCalculated: false },
      select: { id: true, code: true, name: true, statementType: true },
      orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }],
    });
    return NextResponse.json({ ok: true, run, accounts });
  } catch (error) {
    console.error("pdf-extraction-detail-failed", error);
    return NextResponse.json({ error: "Gagal membaca hasil extraction." }, { status: 500 });
  }
}
