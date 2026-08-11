import "server-only";
import { prisma } from "@/lib/prisma";

export type DuplicatePdfResult = {
  duplicate: true;
  committed?: boolean;
  runId?: string;
  jobId?: string;
  status: string;
  message: string;
};

export async function findDuplicatePdf(checksum: string): Promise<DuplicatePdfResult | null> {
  const existingRun = await prisma.extractionRun.findFirst({
    where: { checksum },
    include: { company: { select: { ticker: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (existingRun) {
    const storedPeriod = [existingRun.company.ticker, existingRun.periodType, existingRun.year].filter(Boolean).join(" ");
    const committed = existingRun.status === "COMMITTED";
    return {
      duplicate: true,
      committed,
      runId: existingRun.id,
      status: existingRun.status,
      message: committed
        ? `Data ${storedPeriod} sudah pernah tersimpan di PostgreSQL. Tidak dibuat data duplikat dan AI tidak dipanggil lagi.`
        : `PDF ${storedPeriod || "ini"} sudah pernah diproses. Hasil sebelumnya dibuka tanpa memanggil AI lagi.`,
    };
  }

  const existingJob = await prisma.asyncExtractionJob.findUnique({ where: { checksum } });
  if (existingJob && existingJob.status !== "FAILED") {
    return {
      duplicate: true,
      jobId: existingJob.id,
      status: existingJob.status,
      message: `PDF ini sudah memiliki background job berstatus ${existingJob.status}. Tidak dibuat request AI baru.`,
    };
  }
  return null;
}
