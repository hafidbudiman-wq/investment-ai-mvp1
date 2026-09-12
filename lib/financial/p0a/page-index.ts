import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { P0AIndexedPage, P0APageToken } from "@/lib/financial/p0a/types";

export const P0A_NATIVE_SAFETY_LIMITS = Object.freeze({
  maxBytes: 50 * 1024 * 1024,
  maxPages: 2_000,
  maxPageCharacters: 150_000,
  maxTotalCharacters: 8_000_000,
});

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function pageText(tokens: P0APageToken[]): string {
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    current += `${current ? " " : ""}${token.text}`;
    if (token.lineBreak) {
      if (current.trim()) lines.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) lines.push(current.trim());
  return normalized(lines.join("\n"));
}

function printedPageLabel(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const tail = lines.slice(-8).reverse().find((line) => /^\d{1,4}$/.test(line));
  return tail ?? null;
}

export async function createLocalPageIndex(bytes: Buffer): Promise<P0AIndexedPage[]> {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Invalid PDF header.");
  if (bytes.length > P0A_NATIVE_SAFETY_LIMITS.maxBytes) throw new Error("PDF exceeds P0-A native indexing byte safety limit.");

  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`,
    disableFontFace: true,
    maxImageSize: 0,
    stopAtErrors: true,
  });

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > P0A_NATIVE_SAFETY_LIMITS.maxPages) {
      throw new Error("PDF exceeds P0-A native indexing page safety limit.");
    }
    const pages: P0AIndexedPage[] = [];
    let totalCharacters = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const tokens: P0APageToken[] = [];
      for (const item of content.items) {
        if (!("str" in item) || typeof item.str !== "string" || !item.str.trim()) continue;
        const transform = "transform" in item && Array.isArray(item.transform) ? item.transform : [];
        tokens.push({
          text: item.str,
          x: Number(transform[4] ?? 0),
          y: Number(transform[5] ?? 0),
          width: "width" in item && typeof item.width === "number" ? item.width : 0,
          height: "height" in item && typeof item.height === "number" ? item.height : 0,
          lineBreak: "hasEOL" in item && item.hasEOL === true,
        });
      }
      const text = pageText(tokens);
      if (text.length > P0A_NATIVE_SAFETY_LIMITS.maxPageCharacters) {
        throw new Error(`PDF page ${pageNumber} exceeds P0-A native text safety limit.`);
      }
      totalCharacters += text.length;
      if (totalCharacters > P0A_NATIVE_SAFETY_LIMITS.maxTotalCharacters) {
        throw new Error("PDF exceeds P0-A aggregate native text safety limit.");
      }
      const layoutProjection = tokens.map(({ text: tokenText, x, y, width, height }) => [tokenText, x, y, width, height]);
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        text,
        normalizedText: text.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").trim(),
        textHash: sha256(text),
        layoutHash: sha256(JSON.stringify(layoutProjection)),
        printedPageLabel: printedPageLabel(text),
        tokens,
        extractionStatus: text ? "NATIVE_TEXT" : "EMPTY",
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

export function documentPageCacheKey(documentSha256: string, page: P0AIndexedPage, parserVersion: string): string {
  return sha256([documentSha256, page.pageNumber, parserVersion, page.textHash, page.layoutHash].join(":"));
}
