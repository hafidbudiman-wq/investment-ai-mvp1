import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ready",
      app: "InvestAI",
      version: process.env.npm_package_version ?? "0.1.0",
      database: "connected",
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("health-database-probe-failed", error);
    return NextResponse.json({
      status: "not_ready",
      app: "InvestAI",
      database: "unavailable",
      error: { code: "DATABASE_UNAVAILABLE", message: "PostgreSQL readiness probe failed." },
      checkedAt: new Date().toISOString(),
    }, { status: 503 });
  }
}
