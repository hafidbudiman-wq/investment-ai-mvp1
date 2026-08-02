import { PDFDocument } from "pdf-lib";

export const AI_PDF_MAX_PAGES = 120;

export type PreparedPdfAiInput = {
  bytes: Buffer;
  originalPageCount: number | null;
  submittedPageCount: number | null;
  reduced: boolean;
};

/**
 * Keeps long financial statements below provider TPM limits without requiring
 * the user to split the source document. Primary statements and the first
 * notes are at the front of IDX financial-statement PDFs, which cover the
 * provisional 13-account extraction gate.
 */
export async function preparePdfAiInput(bytes: Buffer): Promise<PreparedPdfAiInput> {
  try {
    const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const originalPageCount = source.getPageCount();
    if (originalPageCount <= AI_PDF_MAX_PAGES) {
      return { bytes, originalPageCount, submittedPageCount: originalPageCount, reduced: false };
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
    };
  } catch (error) {
    console.warn("pdf-ai-input-page-bounding-skipped", error instanceof Error ? error.message : String(error));
    return { bytes, originalPageCount: null, submittedPageCount: null, reduced: false };
  }
}
