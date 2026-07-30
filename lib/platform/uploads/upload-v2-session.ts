import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getPlatformFeatureFlags } from "@/lib/platform/feature-flags";
import { getStorageConfig } from "@/lib/platform/storage/storage-config";
import {
  getUploadV2Policy,
  planUpload,
  sanitizeObjectFileName,
  validatePdfUploadMetadata,
} from "@/lib/platform/uploads/upload-v2-policy";

export class UploadV2Error extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "UPLOAD_V2_ERROR",
  ) {
    super(message);
    this.name = "UploadV2Error";
  }
}

export function assertUploadV2Enabled(): void {
  const flags = getPlatformFeatureFlags();
  if (!flags.pdfUploadV2) {
    throw new UploadV2Error("PDF Upload V2 belum diaktifkan.", 404, "UPLOAD_V2_DISABLED");
  }
}

export function hashResumeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createResumeToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokensEqual(actualHash: string, suppliedToken: string): boolean {
  const suppliedHash = hashResumeToken(suppliedToken);
  const left = Buffer.from(actualHash, "hex");
  const right = Buffer.from(suppliedHash, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function readResumeToken(request: Request): string {
  const value = request.headers.get("x-upload-resume-token")?.trim();
  if (!value || value.length > 256) {
    throw new UploadV2Error("Resume token tidak tersedia.", 401, "RESUME_TOKEN_REQUIRED");
  }
  return value;
}

export async function requireUploadSession(request: Request, id: string) {
  const token = readResumeToken(request);
  const session = await prisma.uploadSession.findUnique({
    where: { id },
    include: { parts: { orderBy: { partNumber: "asc" } }, document: true },
  });
  if (!session || !tokensEqual(session.resumeTokenHash, token)) {
    throw new UploadV2Error("Upload session tidak ditemukan.", 404, "UPLOAD_SESSION_NOT_FOUND");
  }
  if (session.expiresAt.getTime() <= Date.now() && !["UPLOADED", "VERIFIED"].includes(session.status)) {
    throw new UploadV2Error("Upload session sudah kedaluwarsa.", 410, "UPLOAD_SESSION_EXPIRED");
  }
  return session;
}

export async function createUploadSession(input: {
  fileName: string;
  contentType?: string | null;
  size: number;
}) {
  assertUploadV2Enabled();
  const policy = getUploadV2Policy();
  validatePdfUploadMetadata(input, policy);
  const plan = planUpload(input.size, policy);
  const storage = getStorageConfig();
  const correlationId = randomUUID();
  const resumeToken = createResumeToken();
  const safeName = sanitizeObjectFileName(input.fileName);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + policy.sessionTtlSeconds * 1000);
  const objectKey = `financial-documents/${now.getUTCFullYear()}/${now.getUTCMonth() + 1}/${correlationId}/${safeName}`;

  const session = await prisma.uploadSession.create({
    data: {
      correlationId,
      uploadMode: plan.mode,
      status: "INITIATED",
      storageProvider: storage.provider,
      bucket: storage.bucket,
      objectKey,
      originalFileName: input.fileName.trim(),
      mimeType: input.contentType || "application/pdf",
      expectedSize: input.size,
      partSize: plan.partSize,
      resumeTokenHash: hashResumeToken(resumeToken),
      expiresAt,
    },
  });

  return { session, resumeToken, plan, policy, storage };
}

export function uploadSessionView(session: {
  id: string;
  correlationId: string;
  uploadMode: string;
  status: string;
  originalFileName: string;
  mimeType: string;
  expectedSize: number;
  partSize: number | null;
  expiresAt: Date;
  completedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  parts: Array<{ partNumber: number; etag: string; size: number; completedAt: Date }>;
  document?: { id: string; status: string } | null;
}) {
  const completedBytes = session.parts.reduce((sum, part) => sum + part.size, 0);
  return {
    id: session.id,
    correlationId: session.correlationId,
    mode: session.uploadMode,
    status: session.status,
    fileName: session.originalFileName,
    contentType: session.mimeType,
    expectedSize: session.expectedSize,
    partSize: session.partSize,
    completedBytes,
    progressPercent: Math.min(100, Math.floor((completedBytes / session.expectedSize) * 100)),
    completedParts: session.parts.map((part) => ({
      partNumber: part.partNumber,
      etag: part.etag,
      size: part.size,
      completedAt: part.completedAt,
    })),
    expiresAt: session.expiresAt,
    completedAt: session.completedAt,
    errorCode: session.errorCode,
    errorMessage: session.errorMessage,
    document: session.document ? { id: session.document.id, status: session.document.status } : null,
  };
}
