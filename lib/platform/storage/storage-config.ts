import "server-only";
import { z } from "zod";

const storageConfigSchema = z.object({
  provider: z.enum(["RAILWAY", "S3", "R2"]).default("RAILWAY"),
  endpoint: z.string().url(),
  region: z.string().min(1).default("auto"),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().default(true),
  presignExpiresSeconds: z.number().int().min(60).max(3600).default(900),
});

export type StorageConfig = z.infer<typeof storageConfigSchema>;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error("S3_FORCE_PATH_STYLE must be a boolean value.");
}

export function getStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const parsed = storageConfigSchema.safeParse({
    provider: env.STORAGE_PROVIDER ?? "RAILWAY",
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION ?? "auto",
    bucket: env.S3_BUCKET_NAME,
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
    forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE, true),
    presignExpiresSeconds: env.S3_PRESIGN_EXPIRES_SECONDS
      ? Number(env.S3_PRESIGN_EXPIRES_SECONDS)
      : 900,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid document storage configuration: ${detail}`);
  }

  return parsed.data;
}
