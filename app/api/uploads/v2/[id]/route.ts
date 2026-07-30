import { NextResponse } from "next/server";
import { uploadV2JsonError } from "@/lib/platform/uploads/upload-v2-http";
import {
  assertUploadV2Enabled,
  requireUploadSession,
  uploadSessionView,
} from "@/lib/platform/uploads/upload-v2-session";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertUploadV2Enabled();
    const { id } = await context.params;
    const session = await requireUploadSession(request, id);
    return NextResponse.json({ ok: true, session: uploadSessionView(session) });
  } catch (error) {
    return uploadV2JsonError(error);
  }
}
