import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PDF_MAX_BYTES, type UploadedPdfLike, validatePdfUpload } from "@/lib/pdf-extraction";

export const DATABASE_UPLOAD_PART_SIZE = 1024 * 1024;
export const DATABASE_UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const PDF_CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

export type ResumableUploadMetadata = {
  fileName: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
};

export function validateResumableUploadMetadata(value: unknown): ResumableUploadMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Metadata upload tidak valid.");
  const input = value as Record<string, unknown>;
  const fileName = typeof input.fileName === "string" ? input.fileName.trim() : "";
  const mimeType = typeof input.mimeType === "string" ? input.mimeType.trim().toLowerCase() : "";
  const fileSize = typeof input.fileSize === "number" ? input.fileSize : Number.NaN;
  const checksum = typeof input.checksum === "string" ? input.checksum.trim().toLowerCase() : "";
  if (!Number.isInteger(fileSize)) throw new Error("Ukuran PDF tidak valid.");
  if (fileName.length > 255) throw new Error("Nama PDF terlalu panjang.");
  validatePdfUpload({ name: fileName, type: mimeType, size: fileSize } as UploadedPdfLike);
  if (!PDF_CHECKSUM_PATTERN.test(checksum)) throw new Error("Checksum PDF tidak valid.");
  return { fileName, mimeType: mimeType || "application/pdf", fileSize, checksum };
}

export function partCount(fileSize: number, partSize = DATABASE_UPLOAD_PART_SIZE) {
  if (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > PDF_MAX_BYTES) throw new Error("Ukuran PDF tidak valid.");
  if (!Number.isInteger(partSize) || partSize <= 0) throw new Error("Ukuran bagian upload tidak valid.");
  return Math.ceil(fileSize / partSize);
}

export function expectedPartSize(fileSize: number, partSize: number, partNumber: number) {
  const total = partCount(fileSize, partSize);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > total) throw new Error("Nomor bagian upload tidak valid.");
  return partNumber === total ? fileSize - partSize * (total - 1) : partSize;
}

export function createResumeToken() {
  return randomBytes(32).toString("base64url");
}

export function hashResumeToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyResumeToken(token: string | null, expectedHash: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashResumeToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function assertUploadSessionActive(session: { status: string; expiresAt: Date }) {
  if (session.expiresAt.getTime() <= Date.now()) throw new Error("Sesi upload kedaluwarsa. Mulai upload kembali.");
  if (!["INITIATED", "UPLOADING"].includes(session.status)) throw new Error(`Sesi upload tidak aktif (${session.status}).`);
}
