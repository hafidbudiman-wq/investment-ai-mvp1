import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createStructureAwareChunks, type ExtractedPage, type StructureAwareChunk } from "@/lib/financial/statement-chunking";

export const NATIVE_PDF_MAX_BYTES = 12 * 1024 * 1024;
export const NATIVE_PDF_MAX_PAGES = 120;
export const NATIVE_PDF_MAX_CHARACTERS = 2_000_000;
export const NATIVE_PDF_MAX_PAGE_CHARACTERS = 100_000;

function textFromItems(items: readonly unknown[]): string {
  const lines: string[] = [];
  let current = "";
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string") continue;
    current += `${current ? " " : ""}${item.str}`;
    if ("hasEOL" in item && item.hasEOL) {
      if (current.trim()) lines.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.join("\n").trim();
}

/**
 * Uses PDF.js instead of manually inflating arbitrary PDF objects. PDF.js follows
 * the document page tree, applies the active font/ToUnicode mapping, and reads
 * only requested page content. Explicit byte, page, per-page, and aggregate text
 * budgets keep untrusted uploads bounded; a rejected native parse falls back to
 * the validated AI/OCR chunks.
 */
export async function extractNativePdfPages(bytes: Buffer): Promise<ExtractedPage[]> {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Invalid PDF header.");
  if (bytes.length > NATIVE_PDF_MAX_BYTES) throw new Error("PDF exceeds the native parsing byte budget.");

  const standardFontDataUrl = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl,
    disableFontFace: true,
    maxImageSize: 0,
    stopAtErrors: true,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > NATIVE_PDF_MAX_PAGES) {
      throw new Error("PDF exceeds the native parsing page budget.");
    }

    const pages: ExtractedPage[] = [];
    let totalCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const text = textFromItems((await page.getTextContent()).items);
      if (text.length > NATIVE_PDF_MAX_PAGE_CHARACTERS) {
        throw new Error(`PDF page ${pageNumber} exceeds the native text budget.`);
      }
      totalCharacters += text.length;
      if (totalCharacters > NATIVE_PDF_MAX_CHARACTERS) {
        throw new Error("PDF exceeds the aggregate native text budget.");
      }
      pages.push({ pageNumber, text });
      page.cleanup();
    }

    if (!pages.length) throw new Error("PDF does not contain a readable page tree.");
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

export async function chunkNativePdf(bytes: Buffer): Promise<StructureAwareChunk[]> {
  return createStructureAwareChunks(await extractNativePdfPages(bytes), "NATIVE_TEXT");
}
