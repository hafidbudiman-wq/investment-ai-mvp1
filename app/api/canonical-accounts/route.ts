import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const accountSchema = z.object({
  code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional(),
  statementType: z.enum(["INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW", "OTHER"]),
  valueNature: z.enum(["FLOW", "STOCK", "PER_SHARE", "RATIO", "TEXT"]),
  normalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
});

const accountSelect = {
  id: true, code: true, name: true, displayNameId: true, description: true, definition: true,
  investorMeaning: true, aliases: true, relatedMetrics: true, positiveSignals: true, redFlags: true,
  sectorNotes: true, sourceRefs: true, statementType: true, valueNature: true, normalBalance: true,
  isCalculated: true, formula: true,
} as const;

export async function GET() {
  const accounts = await prisma.canonicalAccount.findMany({
    where: { isActive: true },
    orderBy: [{ statementType: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    select: accountSelect,
  });
  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  try {
    const parsed = accountSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Data canonical account tidak valid.", details: parsed.error.flatten() }, { status: 400 });
    const data = parsed.data;
    const existing = await prisma.canonicalAccount.findUnique({ where: { code: data.code } });
    if (existing) return NextResponse.json({ error: `Code ${data.code} sudah digunakan.` }, { status: 409 });
    const last = await prisma.canonicalAccount.findFirst({ where: { statementType: data.statementType }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const account = await prisma.canonicalAccount.create({ data: { ...data, description: data.description || null, normalBalance: data.normalBalance || null, sortOrder: (last?.sortOrder ?? 0) + 10 }, select: accountSelect });
    return NextResponse.json({ ok: true, account }, { status: 201 });
  } catch (error) {
    console.error("canonical-account-create-failed", error);
    return NextResponse.json({ error: "Gagal menyimpan canonical account." }, { status: 500 });
  }
}