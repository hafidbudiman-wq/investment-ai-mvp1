import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256, validatePdfUpload } from "@/lib/pdf-extraction";

export const runtime = "nodejs";

export async function GET() {
  try {
    const runs = await prisma.extractionRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        company: { select: { ticker: true, name: true } },
        _count: { select: { chunks: true, candidates: true } },
      },
    });
    return NextResponse.json({ ok: true, runs });
  } catch (error) {
    console.error("pdf-extraction-list-failed", error);
    return NextResponse.json({ error: "Gagal membaca staging PDF." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const companyId = String(form.get("companyId") ?? "");
    const yearValue = String(form.get("year") ?? "");
    const periodType = String(form.get("periodType") ?? "");

    if (!(file instanceof File)) return NextResponse.json({ error: "PDF belum dipilih." }, { status: 400 });
    if (!companyId) return NextResponse.json({ error: "Company wajib dipilih." }, { status: 400 });
    validatePdfUpload(file);

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, currency: true } });
    if (!company) return NextResponse.json({ error: "Company tidak ditemukan." }, { status: 404 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const checksum = sha256(bytes);
    const existing = await prisma.extractionRun.findUnique({
      where: { companyId_checksum: { companyId, checksum } },
      include: { _count: { select: { chunks: true, candidates: true } } },
    });

    if (existing) {
      return NextResponse.json({ ok: true, duplicate: true, run: existing, message: "PDF yang sama sudah ada di staging. Tidak dibuat duplikat." });
    }

    const year = /^\d{4}$/.test(yearValue) ? Number(yearValue) : null;
    const allowedPeriods = ["Q1", "H1", "Q3", "FY", "MONTHLY"];
    const run = await prisma.extractionRun.create({
      data: {
        companyId,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        checksum,
        year,
        periodType: allowedPeriods.includes(periodType) ? (periodType as "Q1" | "H1" | "Q3" | "FY" | "MONTHLY") : null,
        currency: company.currency,
        status: "UPLOADED",
      },
    });

    return NextResponse.json({
      ok: true,
      duplicate: false,
      run,
      message: "PDF terdaftar di staging. Belum ada nilai yang ditulis ke canonical financial database.",
    });
  } catch (error) {
    console.error("pdf-extraction-upload-failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal membuat staging PDF." }, { status: 500 });
  }
}
