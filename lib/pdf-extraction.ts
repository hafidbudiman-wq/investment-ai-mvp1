import { createHash } from "crypto";

export const PDF_MAX_BYTES = 12 * 1024 * 1024;

export type PdfProcessingMode = "NATIVE_TEXT" | "VISION_OCR_FALLBACK" | "HYBRID";

export type PdfPreflight = {
  processingMode: PdfProcessingMode;
  hasLikelyTextLayer: boolean;
  confidence: number;
  reason: string;
};

export type UploadedPdfLike = {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

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

export function isUploadedPdfLike(value: FormDataEntryValue | null): value is FormDataEntryValue & UploadedPdfLike {
  if (!value || typeof value === "string") return false;
  const candidate = value as unknown as Partial<UploadedPdfLike>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.arrayBuffer === "function"
  );
}

export function validatePdfUpload(file: UploadedPdfLike) {
  const hasPdfExtension = file.name.toLowerCase().endsWith(".pdf");
  const mimeLooksPdf = !file.type || file.type === "application/pdf" || file.type === "application/octet-stream";
  if (!hasPdfExtension || !mimeLooksPdf) {
    throw new Error("File harus berupa PDF.");
  }
  if (file.size <= 0) throw new Error("File PDF kosong.");
  if (file.size > PDF_MAX_BYTES) throw new Error("Ukuran PDF maksimal 12 MB untuk MVP 1.2D.");
}

// Lightweight preflight only decides how the downstream multimodal extractor should treat the PDF.
// It does not attempt to parse financial values. Scanned/image-heavy PDFs are explicitly routed to
// the model's visual/OCR path, while native PDFs retain their text layer and table geometry.
export function inspectPdfForOcr(buffer: Buffer): PdfPreflight {
  const sample = buffer.subarray(0, Math.min(buffer.length, 2_000_000)).toString("latin1");
  const textOperators = (sample.match(/\b(BT|ET|Tj|TJ|Tf)\b/g) || []).length;
  const fontObjects = (sample.match(/\/Font\b/g) || []).length;
  const imageObjects = (sample.match(/\/Subtype\s*\/Image\b/g) || []).length;
  const hasLikelyTextLayer = textOperators >= 3 || fontObjects >= 2;

  if (hasLikelyTextLayer && imageObjects > Math.max(8, textOperators * 2)) {
    return {
      processingMode: "HYBRID",
      hasLikelyTextLayer: true,
      confidence: 0.72,
      reason: "PDF memiliki indikasi text layer sekaligus banyak image object; extractor harus membaca text dan visual table.",
    };
  }

  if (hasLikelyTextLayer) {
    return {
      processingMode: "NATIVE_TEXT",
      hasLikelyTextLayer: true,
      confidence: 0.82,
      reason: "PDF memiliki indikasi text/font operators; prioritaskan native text sambil tetap memeriksa tabel visual.",
    };
  }

  return {
    processingMode: "VISION_OCR_FALLBACK",
    hasLikelyTextLayer: false,
    confidence: 0.78,
    reason: "Text layer tidak terdeteksi dengan cukup kuat; gunakan pembacaan visual/OCR untuk halaman scan.",
  };
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
