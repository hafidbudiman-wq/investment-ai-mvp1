import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const companySchema = z.object({
  ticker: z.string().trim().min(1).max(12).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2),
  sector: z.string().trim().optional(),
  subsector: z.string().trim().optional(),
  currency: z.string().trim().length(3).default("IDR"),
});

export async function GET() {
  try {
    const companies = await prisma.company.findMany({
      include: { _count: { select: { reports: true } } },
      orderBy: { ticker: "asc" },
    });
    return NextResponse.json({ ok: true, companies });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Database is not connected." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const input = companySchema.parse(await request.json());
    const company = await prisma.company.create({ data: input });
    return NextResponse.json({ ok: true, company }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "Unable to save company. Check database connection or duplicate ticker." }, { status: 500 });
  }
}
