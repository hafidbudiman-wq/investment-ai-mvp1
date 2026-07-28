import { NextResponse } from "next/server";
import { syncAsyncExtractionRun } from "@/lib/async-financial-extraction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const run = await syncAsyncExtractionRun(id);
    if (!run) return NextResponse.json({ error: "Extraction run tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ ok: true, runId: run.id, status: run.status, errorMessage: run.errorMessage });
  } catch (error) {
    console.error("async-pdf-extraction-sync-failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Gagal membaca status background extraction." }, { status: 500 });
  }
}
