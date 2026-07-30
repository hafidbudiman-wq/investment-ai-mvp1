import { NextResponse } from "next/server";
import { UploadV2Error } from "@/lib/platform/uploads/upload-v2-session";

export function uploadV2JsonError(error: unknown) {
  if (error instanceof UploadV2Error) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message },
      { status: error.status },
    );
  }
  console.error("upload-v2-unhandled-error", error);
  return NextResponse.json(
    { ok: false, code: "UPLOAD_V2_INTERNAL_ERROR", error: "Upload V2 mengalami gangguan internal." },
    { status: 500 },
  );
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new UploadV2Error("Body request harus berupa JSON yang valid.", 400, "INVALID_JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UploadV2Error("Body request harus berupa object JSON.", 400, "INVALID_JSON_OBJECT");
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new UploadV2Error(`${name} wajib diisi.`, 400, "INVALID_UPLOAD_INPUT");
  }
  return value.trim();
}

export function requirePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new UploadV2Error(`${name} harus berupa bilangan bulat positif.`, 400, "INVALID_UPLOAD_INPUT");
  }
  return value;
}
