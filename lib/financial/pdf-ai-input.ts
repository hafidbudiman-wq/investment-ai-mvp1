import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const AI_PDF_MAX_PAGES = 120;
export const AI_TEXT_MAX_CHARACTERS = 900_000;

export type PreparedPdfAiInput = {
  bytes: Buffer;
  originalPageCount: number | null;
  submittedPageCount: number | null;
  reduced: boolean;
  inputMode: "PDF" | "PAGE_MARKED_TEXT";
  text: string | null;
};

function isEncryptedPdf(bytes: Buffer) {
  return bytes.includes(Buffer.from("/Encrypt", "ascii"));
}

async function extractPageMarkedText(bytes: Buffer): Promise<{ text: string; originalPageCount: number; submittedPageCount: number }> {
  const standardFontDataUrl = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
  const loadingTask = getDocument({ data: new Uint8Array(bytes), standardFontDataUrl });
  const document = await loadingTask.promise;
  const originalPageCount = document.numPages;
  const pages: string[] = [];
  let characters = 0;
  const maximumPages = Math.min(originalPageCount, AI_PDF_MAX_PAGES);
  for (let pageNumber = 1; pageNumber <= maximumPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let current = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      current += `${current ? " " : ""}${item.str}`;
      if (item.hasEOL) {
        if (current.trim()) lines.push(current.trim());
        current = "";
      }
    }
    if (current.trim()) lines.push(current.trim());
    const marked = `[PDF PAGE ${pageNumber}]\n${lines.join("\n")}`;
    if (pages.length > 0 && characters + marked.length > AI_TEXT_MAX_CHARACTERS) break;
    pages.push(marked);
    characters += marked.length;
  }
  await loadingTask.destroy();
  const text = pages.join("\n\n");
  if (text.replace(/\[PDF PAGE \d+\]/g, "").trim().length < 100) throw new Error("Encrypted PDF text layer is empty.");
  return { text, originalPageCount, submittedPageCount: pages.length };
}

/**
 * Keeps long financial statements below provider TPM limits without requiring
 * the user to split the source document. Primary statements and the first
 * notes are at the front of IDX financial-statement PDFs, which cover the
 * provisional 13-account extraction gate.
 */
export async function preparePdfAiInput(bytes: Buffer): Promise<PreparedPdfAiInput> {
  if (isEncryptedPdf(bytes)) {
    try {
      const extracted = await extractPageMarkedText(bytes);
      return {
        bytes,
        originalPageCount: extracted.originalPageCount,
        submittedPageCount: extracted.submittedPageCount,
        reduced: extracted.submittedPageCount < extracted.originalPageCount,
        inputMode: "PAGE_MARKED_TEXT",
        text: extracted.text,
      };
    } catch (error) {
      console.warn("encrypted-pdf-text-extraction-fallback", error instanceof Error ? error.message : String(error));
    }
  }
  try {
    const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const originalPageCount = source.getPageCount();
    if (originalPageCount <= AI_PDF_MAX_PAGES) {
      return { bytes, originalPageCount, submittedPageCount: originalPageCount, reduced: false, inputMode: "PDF", text: null };
    }

    const bounded = await PDFDocument.create();
    const indices = Array.from({ length: AI_PDF_MAX_PAGES }, (_, index) => index);
    const pages = await bounded.copyPages(source, indices);
    for (const page of pages) bounded.addPage(page);
    const saved = await bounded.save({ useObjectStreams: true, addDefaultPage: false });
    return {
      bytes: Buffer.from(saved),
      originalPageCount,
      submittedPageCount: AI_PDF_MAX_PAGES,
      reduced: true,
      inputMode: "PDF",
      text: null,
    };
  } catch (error) {
    console.warn("pdf-ai-input-page-bounding-skipped", error instanceof Error ? error.message : String(error));
    return { bytes, originalPageCount: null, submittedPageCount: null, reduced: false, inputMode: "PDF", text: null };
  }
}
