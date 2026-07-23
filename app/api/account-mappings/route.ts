import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const mappingSchema = z.object({
  sourceLabel: z.string().trim().min(2).max(200),
  canonicalAccountId: z.string().min(1),
  statementType: z.enum(["INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW", "OTHER"]).optional(),
});

function normalizeLabel(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}

export async function GET() {
  const mappings = await prisma.accountMapping.findMany({
    include: { canonicalAccount: { select: { id: true, code: true, name: true, statementType: true } } },
    orderBy: { sourceLabel: "asc" },
  });
  return NextResponse.json({ mappings });
}

export async function POST(request: Request) {
  try {
    const parsed = mappingSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Data mapping tidak valid.", details: parsed.error.flatten() }, { status: 400 });
    const payload = parsed.data;
    const account = await prisma.canonicalAccount.findUnique({ where: { id: payload.canonicalAccountId } });
    if (!account || !account.isActive) return NextResponse.json({ error: "Canonical account tidak ditemukan." }, { status: 404 });
    const mapping = await prisma.accountMapping.upsert({
      where: { sourceLabel: payload.sourceLabel },
      update: { normalizedLabel: normalizeLabel(payload.sourceLabel), canonicalAccountId: account.id, statementType: payload.statementType ?? account.statementType, method: "MANUAL", confidence: 1, isApproved: true },
      create: { sourceLabel: payload.sourceLabel, normalizedLabel: normalizeLabel(payload.sourceLabel), canonicalAccountId: account.id, statementType: payload.statementType ?? account.statementType, method: "MANUAL", confidence: 1, isApproved: true },
      include: { canonicalAccount: { select: { id: true, code: true, name: true, statementType: true } } },
    });
    return NextResponse.json({ ok: true, mapping });
  } catch (error) {
    console.error("account-mapping-save-failed", error);
    return NextResponse.json({ error: "Gagal menyimpan account mapping." }, { status: 500 });
  }
}
