import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inspectPdfForOcr, isUploadedPdfLike, sha256, validatePdfUpload } from "@/lib/pdf-extraction";
import { createAsyncJob, findJobByChecksum, listActiveJobs, updateAsyncJob } from "@/lib/async-extraction-jobs";
import { submitFinancialPdfBackground } from "@/lib/openai-financial-extraction";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const jobs = await listActiveJobs();
    return NextResponse.json({
      ok: true,
      jobs: jobs.map((job) => ({
        id: job.id,
        fileName: job.fileName,
        fileSize: job.fileSize,
        status: job.status,
        runId: job.runId,
        errorMessage: job.errorMessage,
        updatedAt: job.updatedAt,
        createdAt: job.createdAt,
      })),
    });
  } catch (error) {
    console.error("async-extraction-job-list-failed", error);
    return NextResponse.json({ error: "Gagal membaca background extraction jobs." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let jobId: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    const confirmedCompanyId = String(form.get("confirmedCompanyId") ?? "") || null;
    if (!isUploadedPdfLike(file)) return NextResponse.json({ error: "PDF belum dipilih atau upload tidak terbaca." }, { status: 400 });
    validatePdfUpload(file);

    const bytes = Buffer.from(await file.arrayBuffer());
    const checksum = sha256(bytes);

    const existingRun = await prisma.extractionRun.findFirst({ where: { checksum }, orderBy: { createdAt: "desc" }, include: { company: { select: { ticker: true } } } });
    if (existingRun) {
      return NextResponse.json({ ok: true, duplicate: true, runId: existingRun.id, message: `PDF ini sudah pernah diproses sebagai ${existingRun.company.ticker} ${existingRun.periodType ?? "?"} ${existingRun.year ?? "?"}. Tidak ada token AI baru yang digunakan.` });
    }

    const existingJob = await findJobByChecksum(checksum);
    if (existingJob) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        jobId: existingJob.id,
        runId: existingJob.runId,
        status: existingJob.status,
        message: existingJob.status === "FAILED"
          ? "PDF ini memiliki job FAILED sebelumnya. Buka status job untuk melihat error sebelum retry."
          : "PDF ini sedang atau sudah diproses sebagai background job. Tidak ada token AI baru yang digunakan.",
      });
    }

    const preflight = inspectPdfForOcr(bytes);
    const [companies, accounts] = await Promise.all([
      prisma.company.findMany({ where: { isActive: true }, select: { id: true, ticker: true, name: true, currency: true } }),
      prisma.canonicalAccount.findMany({ where: { isActive: true, isCalculated: false }, select: { id: true, code: true, name: true, statementType: true, aliases: true }, orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }] }),
    ]);

    const job = await createAsyncJob({
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      fileSize: file.size,
      checksum,
      confirmedCompanyId,
      preflight: { processingMode: preflight.processingMode, confidence: preflight.confidence, reason: preflight.reason },
    });
    jobId = job.id;

    const response = await submitFinancialPdfBackground({
      bytes,
      fileName: file.name,
      knownCompanies: companies.map((company) => ({ ticker: company.ticker, name: company.name })),
      accounts,
      preflight,
    });

    await updateAsyncJob(job.id, { status: "PROCESSING", openAiResponseId: response.id, errorMessage: null });

    return NextResponse.json({
      ok: true,
      accepted: true,
      jobId: job.id,
      status: "PROCESSING",
      message: "Upload diterima. AI memproses PDF di background; halaman boleh ditutup dan status dapat dipantau dari pipeline.",
    }, { status: 202 });
  } catch (error) {
    console.error("async-extraction-submit-failed", error);
    if (jobId) await updateAsyncJob(jobId, { status: "FAILED", errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Background submission failed" }).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal membuat background extraction job." }, { status: 500 });
  }
}
