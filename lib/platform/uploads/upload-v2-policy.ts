export const MIB = 1024 * 1024;

export type UploadV2Policy = {
  maxBytes: number;
  singlePutThresholdBytes: number;
  multipartPartSizeBytes: number;
  sessionTtlSeconds: number;
  maxParts: number;
};

export const DEFAULT_UPLOAD_V2_POLICY: UploadV2Policy = {
  maxBytes: 50 * MIB,
  singlePutThresholdBytes: 8 * MIB,
  multipartPartSizeBytes: 5 * MIB,
  sessionTtlSeconds: 24 * 60 * 60,
  maxParts: 10_000,
};

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}

export function getUploadV2Policy(
  env: NodeJS.ProcessEnv = process.env,
): UploadV2Policy {
  const policy: UploadV2Policy = {
    maxBytes: readPositiveInteger(
      env,
      "PDF_UPLOAD_V2_MAX_BYTES",
      DEFAULT_UPLOAD_V2_POLICY.maxBytes,
    ),
    singlePutThresholdBytes: readPositiveInteger(
      env,
      "PDF_UPLOAD_V2_SINGLE_PUT_BYTES",
      DEFAULT_UPLOAD_V2_POLICY.singlePutThresholdBytes,
    ),
    multipartPartSizeBytes: readPositiveInteger(
      env,
      "PDF_UPLOAD_V2_PART_SIZE_BYTES",
      DEFAULT_UPLOAD_V2_POLICY.multipartPartSizeBytes,
    ),
    sessionTtlSeconds: readPositiveInteger(
      env,
      "PDF_UPLOAD_V2_SESSION_TTL_SECONDS",
      DEFAULT_UPLOAD_V2_POLICY.sessionTtlSeconds,
    ),
    maxParts: DEFAULT_UPLOAD_V2_POLICY.maxParts,
  };

  if (policy.multipartPartSizeBytes < 5 * MIB) {
    throw new Error("PDF_UPLOAD_V2_PART_SIZE_BYTES must be at least 5 MiB.");
  }
  if (policy.singlePutThresholdBytes > policy.maxBytes) {
    throw new Error("PDF_UPLOAD_V2_SINGLE_PUT_BYTES cannot exceed the maximum upload size.");
  }
  return policy;
}

export type UploadPlan = {
  mode: "SINGLE_PUT" | "MULTIPART";
  partSize: number | null;
  partCount: number;
};

export function validatePdfUploadMetadata(input: {
  fileName: string;
  contentType?: string | null;
  size: number;
}, policy: UploadV2Policy): void {
  const fileName = input.fileName.trim();
  if (!fileName || fileName.length > 255) {
    throw new Error("Nama file PDF tidak valid.");
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    throw new Error("File harus menggunakan ekstensi .pdf.");
  }
  const contentType = (input.contentType || "application/pdf").toLowerCase();
  if (!["application/pdf", "application/octet-stream"].includes(contentType)) {
    throw new Error("Tipe file harus PDF.");
  }
  if (!Number.isSafeInteger(input.size) || input.size <= 0) {
    throw new Error("Ukuran file PDF tidak valid.");
  }
  if (input.size > policy.maxBytes) {
    throw new Error(
      `Ukuran PDF melebihi batas Upload V2 (${Math.floor(policy.maxBytes / MIB)} MiB).`,
    );
  }
}

export function planUpload(size: number, policy: UploadV2Policy): UploadPlan {
  if (size <= policy.singlePutThresholdBytes) {
    return { mode: "SINGLE_PUT", partSize: null, partCount: 1 };
  }
  const partCount = Math.ceil(size / policy.multipartPartSizeBytes);
  if (partCount > policy.maxParts) {
    throw new Error("PDF membutuhkan terlalu banyak multipart parts.");
  }
  return {
    mode: "MULTIPART",
    partSize: policy.multipartPartSizeBytes,
    partCount,
  };
}

export function expectedPartSize(input: {
  expectedSize: number;
  partSize: number;
  partNumber: number;
}): number {
  const partCount = Math.ceil(input.expectedSize / input.partSize);
  if (!Number.isInteger(input.partNumber) || input.partNumber < 1 || input.partNumber > partCount) {
    throw new Error("Nomor part berada di luar upload plan.");
  }
  if (input.partNumber < partCount) return input.partSize;
  return input.expectedSize - input.partSize * (partCount - 1);
}

export function normalizeEtag(value: string): string {
  const normalized = value.trim().replace(/^"|"$/g, "");
  if (!normalized || normalized.length > 512 || /[\r\n]/.test(normalized)) {
    throw new Error("ETag part tidak valid.");
  }
  return normalized;
}

export function sanitizeObjectFileName(fileName: string): string {
  const withoutPath = fileName.split(/[\\/]/).pop() || "document.pdf";
  const stem = withoutPath.replace(/\.pdf$/i, "");
  const safeStem = stem
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80) || "document";
  return `${safeStem}.pdf`;
}
