import { randomUUID } from "crypto";
import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inspectPdfForOcr, isUploadedPdfLike, sha256, validatePdfUpload } from "@/lib/pdf-extraction";
import { createAsyncJob, findAsyncJobByChecksum, kickQueuedAsyncExtractionJobs, listAsyncJobs, pollAsyncExtractionJobs, submitQueuedAsyncJob } from "@/lib/async-pdf-extraction";

export const runtime = "nodejs";
export const maxDuration = 60;

const FILTERS: Record<string, string[]> = {
  ALL: [],
  NEED_REVIEW: ["UPLOADED", "SUBMITTING", "PROCESSING", "PENDING_REVIEW"],
  READY_TO_COMMIT: ["READY_TO_COMMIT"],
  COMMITTED: ["COMMITTED"],
  FAILED: ["FAILED"],
};

export async function GET(request: Request) {
  try {
    await kickQueuedAsyncExtractionJobs();
    await pollAsyncExtractionJobs();
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get("pageSize") || 20) || 20));
    const filter = (url.searchParams.get("filter") || "ALL").toUpperCase();
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const [runs, jobs] = await Promise.all([
      prisma.extractionRun.findMany({ orderBy: { updatedAt: "desc" }, take: 300, include: { company: { select: { ticker: true, name: true } }, candidates: { select: { status: true } }, _count: { select: { chunks: true, candidates: true } } } }),
      listAsyncJobs(),
    ]);
    const runRows = runs.map((run) => {
      const review = run.candidates.reduce((acc, candidate) => {
        if (candidate.status === "PENDING") acc.pending += 1;
        else if (candidate.status === "ACCEPTED") acc.accepted += 1;
        else if (candidate.status === "REJECTED") acc.rejected += 1;
        else if (candidate.status === "COMMITTED") acc.committed += 1;
        return acc;
      }, { pending: 0, accepted: 0, rejected: 0, committed: 0 });
      const { candidates: _candidates, ...rest } = run;
      return { ...rest, kind: "RUN" as const, review };
    });
    const jobRows = jobs.map((job) => ({ id: job.id, kind: "JOB" as const, fileName: job.fileName, status: job.status, year: job.detectedYear, periodType: job.detectedPeriodType, updatedAt: job.updatedAt, company: { ticker: job.detectedTicker || "AI DETECTING", name: job.detectedCompanyName || "Background extraction in progress" }, review: { pending: 0, accepted: 0, rejected: 0, committed: 0 }, _count: { chunks: 0, candidates: 0 }, errorMessage: job.errorMessage }));
    const allRows = [...jobRows, ...runRows].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const wanted = FILTERS[filter] ?? [];
    const filtered = allRows.filter((row) => {
      const statusMatch = wanted.length === 0 || wanted.includes(row.status);
      const haystack = `${row.company.ticker} ${row.company.name} ${row.fileName}`.toLowerCase();
      return statusMatch && (!search || haystack.includes(search));
    });
    const total = filtered.length;
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
    const count = (statuses: string[]) => {
      const rows = allRows.filter((row) => statuses.includes(row.status));
      return { reports: rows.length, companies: new Set(rows.map((row) => row.company.ticker).filter((ticker) => ticker !== "AI DETECTING")).size };
    };
    const summary = { all: { reports: allRows.length, companies: new Set(allRows.map((row) => row.company.ticker).filter((ticker) => ticker !== "AI DETECTING")).size }, needReview: count(FILTERS.NEED_REVIEW), readyToCommit: count(FILTERS.READY_TO_COMMIT), committed: count(FILTERS.COMMITTED), failed: count(FILTERS.FAILED) };
    return NextResponse.json({ ok: true, runs: paged, summary, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, filter, search });
  } catch (error) {
    console.error("pdf-extraction-list-failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal membaca Financial Report Pipeline." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!isUploadedPdfLike(file)) return NextResponse.json({ error: "PDF belum dipilih atau upload tidak terbaca dengan benar." }, { status: 400 });
    validatePdfUpload(file);
    const bytes = Buffer.from(await file.arrayBuffer());
    const checksum = sha256(bytes);
    const existingRun = await prisma.extractionRun.findFirst({ where: { checksum }, orderBy: { createdAt: "desc" } });
    if (existingRun) return NextResponse.json({ ok: true, duplicate: true, runId: existingRun.id, message: "PDF ini sudah pernah diproses. Hasil sebelumnya dibuka tanpa memanggil AI lagi." });
    const existingJob = await findAsyncJobByChecksum(checksum);
    if (existingJob && existingJob.status !== "FAILED") return NextResponse.json({ ok: true, duplicate: true, jobId: existingJob.id, status: existingJob.status, message: `PDF ini sudah memiliki background job berstatus ${existingJob.status}. Tidak dibuat request AI baru.` }, { status: 202 });
    const preflight = inspectPdfForOcr(bytes);
    const jobId = existingJob?.id ?? randomUUID();
    await createAsyncJob({ id: jobId, fileName: file.name, mimeType: file.type || "application/pdf", fileSize: file.size, checksum, preflight, bytes });
    after(async () => { await submitQueuedAsyncJob(jobId); });
    return NextResponse.json({ ok: true, accepted: true, retried: Boolean(existingJob), jobId, status: "UPLOADED", message: existingJob ? "Upload ulang diterima. Job gagal sebelumnya di-reset dan akan diproses kembali tanpa menunggu browser." : "Upload diterima dan job sudah tersimpan. AI akan memproses PDF di background; halaman boleh ditutup." }, { status: 202 });
  } catch (error) {
    console.error("pdf-extraction-upload-ack-failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal menyimpan PDF sebagai background job." }, { status: 500 });
  }
}
