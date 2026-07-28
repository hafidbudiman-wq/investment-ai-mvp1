import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inspectPdfForOcr, isUploadedPdfLike, sha256, validatePdfUpload } from "@/lib/pdf-extraction";
import { submitFinancialPdfBackground } from "@/lib/openai-financial-extraction";

export const runtime = "nodejs";
export const maxDuration = 60;

const PLACEHOLDER_TICKER = "__PENDING_AI__";

export async function POST(request: Request) {
  let runId: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!isUploadedPdfLike(file)) return NextResponse.json({ error: "PDF belum dipilih atau upload tidak terbaca dengan benar." }, { status: 400 });
    validatePdfUpload(file);

    const bytes = Buffer.from(await file.arrayBuffer());
    const checksum = sha256(bytes);

    const existing = await prisma.extractionRun.findFirst({
      where: { checksum },
      orderBy: { createdAt: "desc" },
      include: { company: { select: { ticker: true, name: true } }, _count: { select: { chunks: true, candidates: true } } },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        runId: existing.id,
        run: existing,
        message: existing.status === "PROCESSING" || existing.status === "UPLOADED"
          ? "PDF yang sama sedang diproses. Job lama dibuka tanpa memanggil OpenAI lagi."
          : `PDF ini sudah pernah diproses sebagai ${existing.company.ticker} · ${existing.periodType ?? "?"} ${existing.year ?? "?"}.`,
      });
    }

    const placeholderCompany = await prisma.company.upsert({
      where: { ticker: PLACEHOLDER_TICKER },
      update: { isActive: false },
      create: { ticker: PLACEHOLDER_TICKER, name: "AI is detecting issuer", country: "ID", currency: "IDR", fiscalYearEnd: 12, isActive: false },
      select: { id: true },
    });

    const run = await prisma.extractionRun.create({
      data: {
        companyId: placeholderCompany.id,
        fileName: file.name,
        mimeType: file.type || "application/pdf",
        fileSize: file.size,
        checksum,
        status: "UPLOADED",
        parserVersion: "mvp-1.2d-async:submitting",
      },
    });
    runId = run.id;

    const preflight = inspectPdfForOcr(bytes);
    const [companies, accounts] = await Promise.all([
      prisma.company.findMany({ where: { isActive: true }, select: { ticker: true, name: true } }),
      prisma.canonicalAccount.findMany({ where: { isActive: true, isCalculated: false }, select: { id: true, code: true, name: true, statementType: true, aliases: true }, orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }] }),
    ]);

    const background = await submitFinancialPdfBackground({
      bytes,
      fileName: file.name,
      knownCompanies: companies,
      accounts,
      preflight,
    });

    await prisma.extractionRun.update({
      where: { id: run.id },
      data: {
        status: "PROCESSING",
        parserVersion: `mvp-1.2d-async:${background.id}`,
        errorMessage: null,
      },
    });

    return NextResponse.json({
      ok: true,
      accepted: true,
      runId: run.id,
      status: "PROCESSING",
      message: "Upload diterima. AI memproses PDF di background; halaman dapat ditutup dan status akan tetap tersimpan di Pipeline.",
    }, { status: 202 });
  } catch (error) {
    console.error("async-pdf-extraction-submit-failed", error);
    if (runId) {
      await prisma.extractionRun.update({
        where: { id: runId },
        data: { status: "FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Background submission failed" },
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal mengirim PDF ke background processor." }, { status: 500 });
  }
}
