import { createHash } from "crypto";

export const PDF_MAX_BYTES = 12 * 1024 * 1024;

export function normalizeReportedLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function validatePdfUpload(file: File) {
  if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
    throw new Error("File harus berupa PDF.");
  }
  if (file.size <= 0) throw new Error("File PDF kosong.");
  if (file.size > PDF_MAX_BYTES) throw new Error("Ukuran PDF maksimal 12 MB untuk MVP 1.2D.");
}

export type ChunkDraft = {
  ordinal: number;
  chunkType: "SECTION" | "TABLE" | "PAGE" | "TOKEN_BLOCK";
  pageStart?: number;
  pageEnd?: number;
  section?: string;
  text: string;
};

// Structure-aware fallback for text that has already been extracted from a PDF.
// Native tables/sections should be passed as separate blocks; token slicing is only a last resort.
export function chunkExtractedText(text: string, maxChars = 6000): ChunkDraft[] {
  const blocks = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks: ChunkDraft[] = [];
  let current = "";

  const flush = () => {
    if (!current.trim()) return;
    chunks.push({ ordinal: chunks.length, chunkType: "TOKEN_BLOCK", text: current.trim() });
    current = "";
  };

  for (const block of blocks) {
    if (block.length > maxChars) {
      flush();
      for (let offset = 0; offset < block.length; offset += maxChars) {
        chunks.push({ ordinal: chunks.length, chunkType: "TOKEN_BLOCK", text: block.slice(offset, offset + maxChars) });
      }
      continue;
    }
    if (current.length + block.length + 2 > maxChars) flush();
    current += `${current ? "\n\n" : ""}${block}`;
  }
  flush();
  return chunks;
}
