export type PlatformFeatureFlags = {
  pdfUploadV2: boolean;
  pdfUploadLegacy: boolean;
  genericJobWorker: boolean;
  metadataConfirmationV2: boolean;
};

function readBoolean(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value == null || value === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be one of true/false, 1/0, yes/no, or on/off.`);
}

export function assertSafeUploadFlagCombination(flags: PlatformFeatureFlags): void {
  if (!flags.pdfUploadV2 && !flags.pdfUploadLegacy) {
    throw new Error("At least one PDF upload path must remain enabled.");
  }
  if (flags.pdfUploadV2 && !flags.genericJobWorker) {
    throw new Error("PDF_UPLOAD_V2 requires GENERIC_JOB_WORKER to be enabled.");
  }
}

export function getPlatformFeatureFlags(): PlatformFeatureFlags {
  const flags: PlatformFeatureFlags = {
    pdfUploadV2: readBoolean("PDF_UPLOAD_V2", false),
    pdfUploadLegacy: readBoolean("PDF_UPLOAD_LEGACY", true),
    genericJobWorker: readBoolean("GENERIC_JOB_WORKER", false),
    metadataConfirmationV2: readBoolean("METADATA_CONFIRMATION_V2", false),
  };
  assertSafeUploadFlagCombination(flags);
  return flags;
}
