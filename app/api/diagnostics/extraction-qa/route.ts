import { NextResponse } from "next/server";
import { readExtractionQa } from "@/lib/financial/p0a/compatibility-read";
import { getPlatformFeatureFlags } from "@/lib/platform/feature-flags";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERIOD_TYPES = new Set(["Q1", "H1", "Q3", "FY", "MONTHLY"]);

export async function GET(request: Request) {
  if (!getPlatformFeatureFlags().investaiExtractionQa) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const passId = url.searchParams.get("passId")?.trim() || undefined;
  const ticker = (url.searchParams.get("ticker") || "ICBP").trim().toUpperCase();
  const year = Number(url.searchParams.get("year") || "2025");
  const periodType = (url.searchParams.get("periodType") || "H1").trim().toUpperCase();
  if (passId && passId.length > 128) {
    return NextResponse.json({ error: "passId is invalid." }, { status: 400 });
  }
  if (!/^[A-Z0-9.-]{1,20}$/.test(ticker)) {
    return NextResponse.json({ error: "Ticker is invalid." }, { status: 400 });
  }
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return NextResponse.json({ error: "Year is invalid." }, { status: 400 });
  }
  if (!PERIOD_TYPES.has(periodType)) {
    return NextResponse.json({ error: "Period type is invalid." }, { status: 400 });
  }

  try {
    const data = await readExtractionQa(prisma, { passId, ticker, year, periodType });
    if (!data) return NextResponse.json({ error: "Shadow extraction pass was not found." }, { status: 404 });
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("extraction-qa-read-failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Extraction QA read failed." }, { status: 500 });
  }
}
