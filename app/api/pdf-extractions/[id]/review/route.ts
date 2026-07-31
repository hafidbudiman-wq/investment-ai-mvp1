import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const reviewSchema = z.object({
  candidateId: z.string().min(1),
  decision: z.enum(["PENDING", "ACCEPTED", "REJECTED"]),
  canonicalAccountId: z.string().min(1).nullable().optional(),
  reviewNote: z.string().max(1000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const parsed = reviewSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Review candidate tidak valid." }, { status: 400 });

    const run = await prisma.extractionRun.findUnique({ where: { id }, select: { status: true } });
    if (!run) return NextResponse.json({ error: "Extraction run tidak ditemukan." }, { status: 404 });
    if (run.status === "COMMITTED") {
      return NextResponse.json({ error: "Data sudah FINAL COMMIT dan dikunci. Koreksi setelah commit harus melalui revision flow, bukan mengubah status review lama." }, { status: 409 });
    }

    const candidate = await prisma.extractionCandidate.findFirst({ where: { id: parsed.data.candidateId, runId: id } });
    if (!candidate) return NextResponse.json({ error: "Candidate tidak ditemukan." }, { status: 404 });

    const targetAccountId = parsed.data.canonicalAccountId === undefined ? candidate.canonicalAccountId : parsed.data.canonicalAccountId;
    if (parsed.data.decision === "ACCEPTED" && !targetAccountId) {
      return NextResponse.json({ error: "Candidate hanya dapat diterima setelah canonical account dipilih." }, { status: 400 });
    }

    if (targetAccountId) {
      const target = await prisma.canonicalAccount.findFirst({ where: { id: targetAccountId, isActive: true }, select: { statementType: true } });
      if (!target) return NextResponse.json({ error: "Canonical account tidak tersedia atau tidak aktif." }, { status: 400 });
      if (candidate.statementType && candidate.statementType !== "OTHER" && target.statementType !== candidate.statementType) {
        return NextResponse.json({ error: "Canonical account harus berasal dari jenis laporan yang sama dengan candidate." }, { status: 422 });
      }
    }

    const { updated, pending } = await prisma.$transaction(async (tx) => {
      const updated = await tx.extractionCandidate.update({
        where: { id: candidate.id },
        data: {
          status: parsed.data.decision,
          canonicalAccountId: targetAccountId,
          reviewNote: parsed.data.reviewNote ?? (parsed.data.decision === "PENDING" ? "Returned to pending for review." : null),
          reviewedBy: parsed.data.decision === "PENDING" ? null : "web-user",
          reviewedAt: parsed.data.decision === "PENDING" ? null : new Date(),
        },
      });
      const pending = await tx.extractionCandidate.count({ where: { runId: id, status: "PENDING" } });
      await tx.extractionRun.update({ where: { id }, data: { status: pending === 0 ? "READY_TO_COMMIT" : "PENDING_REVIEW" } });
      await tx.auditLog.create({ data: {
        action: "EXTRACTION_CANDIDATE_REVIEWED",
        actor: parsed.data.decision === "PENDING" ? "web-user" : updated.reviewedBy,
        entity: "ExtractionCandidate",
        entityId: candidate.id,
        before: { status: candidate.status, canonicalAccountId: candidate.canonicalAccountId, reviewNote: candidate.reviewNote },
        after: { status: updated.status, canonicalAccountId: updated.canonicalAccountId, reviewNote: updated.reviewNote, runId: id },
      } });
      return { updated, pending };
    });

    return NextResponse.json({ ok: true, candidate: updated, pending });
  } catch (error) {
    console.error("pdf-candidate-review-failed", error);
    return NextResponse.json({ error: "Gagal menyimpan review." }, { status: 500 });
  }
}
