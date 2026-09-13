import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { P0A_REQUIREMENT_BY_ID } from "@/lib/financial/p0a/requirements";
import type { P0AIndexedPage, P0AOcrSourceMetadata, P0APageToken, P0ARoutedPage } from "@/lib/financial/p0a/types";

const execFile = promisify(execFileCallback);
const OCR_DPI = 300;
const OCR_LANGUAGE = "eng+ind";
const OCR_PSM = 6;
const MIN_PAGE_CONFIDENCE = 0.8;
const MIN_NUMERIC_CONFIDENCE = 0.75;
const MAX_PRIMARY_CORRIDOR_PAGES = 8;

export type P0AOcrRuntime = {
  engine: "tesseract";
  engineVersion: string;
  renderer: "pdftoppm";
  rendererVersion: string;
  language: string;
  pageSegmentationMode: number;
  renderDpi: number;
};

export type P0AOcrPageDecision = {
  pageNumber: number;
  reason: string;
};

export type P0AOcrCompatibilityUsage = {
  runtime: P0AOcrRuntime | null;
  candidatePages: number[];
  candidateReasons: P0AOcrPageDecision[];
  ocrPages: number[];
  reusedOcrPages: number[];
  rejectedPages: Array<{ pageNumber: number; reason: string }>;
  executionCount: number;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function printedPageLabel(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.slice(-8).reverse().find((line) => /^\d{1,4}$/.test(line)) ?? null;
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || bytes.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("OCR renderer did not produce a valid PNG.");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function cleanVersion(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? value.trim();
}

export async function inspectLocalOcrRuntime(): Promise<P0AOcrRuntime> {
  const [tesseract, renderer, languages] = await Promise.all([
    execFile("tesseract", ["--version"], { maxBuffer: 2_000_000 }),
    execFile("pdftoppm", ["-v"], { maxBuffer: 2_000_000 }),
    execFile("tesseract", ["--list-langs"], { maxBuffer: 2_000_000 }),
  ]).catch((error) => {
    throw new Error(`P0-A OCR runtime unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });
  const languageText = `${languages.stdout}\n${languages.stderr}`;
  for (const required of ["eng", "ind"]) {
    if (!new RegExp(`^${required}$`, "m").test(languageText)) throw new Error(`P0-A OCR runtime missing Tesseract language: ${required}`);
  }
  return {
    engine: "tesseract",
    engineVersion: cleanVersion(`${tesseract.stdout}\n${tesseract.stderr}`),
    renderer: "pdftoppm",
    rendererVersion: cleanVersion(`${renderer.stdout}\n${renderer.stderr}`),
    language: OCR_LANGUAGE,
    pageSegmentationMode: OCR_PSM,
    renderDpi: OCR_DPI,
  };
}

function eligible(page: P0AIndexedPage | undefined): boolean {
  return Boolean(page && (page.contentClass === "IMAGE_ONLY" || page.contentClass === "INSUFFICIENT_TEXT"));
}

/**
 * OCR is planned only when unresolved PRIMARY requirements point to missing
 * primary statement types and those missing statements are adjacent to the
 * native primary-statement corridor. No issuer, page number, or gold value is used.
 */
export function planOcrCompatibilityPages(
  index: readonly P0AIndexedPage[],
  routed: readonly P0ARoutedPage[],
  unresolvedRequirementIds: readonly string[],
): P0AOcrPageDecision[] {
  const unresolvedTypes = new Set(unresolvedRequirementIds.flatMap((id) => {
    const requirement = P0A_REQUIREMENT_BY_ID.get(id);
    return requirement?.routes.includes("PRIMARY") ? [requirement.statementType] : [];
  }));
  if (!unresolvedTypes.size) return [];

  const nativePrimary = routed.filter((page) => page.pageClass.startsWith("PRIMARY_") && page.sourceType !== "OCR");
  if (!nativePrimary.length) return [];
  const detectedTypes = new Set(nativePrimary.map((page) => page.statementType));
  const missingTypes = [...unresolvedTypes].filter((type) => !detectedTypes.has(type));
  if (!missingTypes.length) return [];

  const byNumber = new Map(index.map((page) => [page.pageNumber, page]));
  const first = Math.min(...nativePrimary.map((page) => page.pageNumber));
  const last = Math.max(...nativePrimary.map((page) => page.pageNumber));
  const decisions = new Map<number, P0AOcrPageDecision>();

  const needsEarlier = missingTypes.some((type) => type === "BALANCE_SHEET" || type === "INCOME_STATEMENT" || type === "CHANGES_IN_EQUITY");
  if (needsEarlier) {
    for (let pageNumber = first - 1, scanned = 0; pageNumber >= 1 && scanned < MAX_PRIMARY_CORRIDOR_PAGES; pageNumber -= 1, scanned += 1) {
      const page = byNumber.get(pageNumber);
      if (!eligible(page)) break;
      decisions.set(pageNumber, { pageNumber, reason: `Image/insufficient-text page is contiguous before the native primary-statement corridor while primary statement types ${missingTypes.join(", ")} remain unresolved.` });
    }
  }

  const needsLater = missingTypes.includes("CASH_FLOW");
  if (needsLater) {
    for (let pageNumber = last + 1, scanned = 0; pageNumber <= index.length && scanned < MAX_PRIMARY_CORRIDOR_PAGES; pageNumber += 1, scanned += 1) {
      const page = byNumber.get(pageNumber);
      if (!eligible(page)) break;
      decisions.set(pageNumber, { pageNumber, reason: "Image/insufficient-text page is contiguous after the native primary-statement corridor while cash-flow requirements remain unresolved." });
    }
  }

  for (let pageNumber = first; pageNumber <= last; pageNumber += 1) {
    if (eligible(byNumber.get(pageNumber))) decisions.set(pageNumber, { pageNumber, reason: "Image/insufficient-text page lies inside the native primary-statement corridor." });
  }
  return [...decisions.values()].sort((a, b) => a.pageNumber - b.pageNumber);
}

type TsvWord = {
  block: number;
  paragraph: number;
  line: number;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
  text: string;
};

function parseTsv(value: string): TsvWord[] {
  const lines = value.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  const at = (parts: string[], name: string) => parts[header.indexOf(name)] ?? "";
  return lines.slice(1).flatMap((line) => {
    const parts = line.split("\t");
    if (at(parts, "level") !== "5") return [];
    const text = at(parts, "text").trim();
    const confidence = Number(at(parts, "conf"));
    if (!text || !Number.isFinite(confidence) || confidence < 0) return [];
    return [{
      block: Number(at(parts, "block_num")), paragraph: Number(at(parts, "par_num")), line: Number(at(parts, "line_num")),
      left: Number(at(parts, "left")), top: Number(at(parts, "top")), width: Number(at(parts, "width")), height: Number(at(parts, "height")),
      confidence: confidence / 100, text,
    }];
  });
}

function tokensFromWords(words: readonly TsvWord[], page: P0AIndexedPage, imageWidth: number, imageHeight: number): P0APageToken[] {
  const groups = new Map<string, TsvWord[]>();
  for (const word of words) {
    const key = `${word.block}:${word.paragraph}:${word.line}`;
    groups.set(key, [...(groups.get(key) ?? []), word]);
  }
  const lines = [...groups.values()].map((lineWords) => [...lineWords].sort((a, b) => a.left - b.left))
    .sort((a, b) => Math.min(...a.map((word) => word.top)) - Math.min(...b.map((word) => word.top)) || a[0].left - b[0].left);
  const xScale = page.width / imageWidth;
  const yScale = page.height / imageHeight;
  const tokens: P0APageToken[] = [];
  for (const lineWords of lines) {
    const lineTop = Math.min(...lineWords.map((word) => word.top));
    const lineBottom = Math.max(...lineWords.map((word) => word.top + word.height));
    const y = page.height - ((lineTop + lineBottom) / 2) * yScale;
    lineWords.forEach((word, index) => tokens.push({
      text: word.text,
      x: word.left * xScale,
      y,
      width: word.width * xScale,
      height: word.height * yScale,
      lineBreak: index === lineWords.length - 1,
      confidence: word.confidence,
    }));
  }
  return tokens;
}

function textFromTokens(tokens: readonly P0APageToken[]): string {
  const lines: string[] = [];
  let current = "";
  for (const token of tokens) {
    current += `${current ? " " : ""}${token.text}`;
    if (token.lineBreak) { if (current.trim()) lines.push(current.trim()); current = ""; }
  }
  if (current.trim()) lines.push(current.trim());
  return normalize(lines.join("\n"));
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export async function ocrCompatiblePages(input: {
  bytes: Buffer;
  index: readonly P0AIndexedPage[];
  decisions: readonly P0AOcrPageDecision[];
}): Promise<{ pages: P0AIndexedPage[]; runtime: P0AOcrRuntime; rejectedPages: Array<{ pageNumber: number; reason: string }> }> {
  const runtime = await inspectLocalOcrRuntime();
  const directory = await mkdtemp(path.join(tmpdir(), "investai-p0a-ocr-"));
  const pdfPath = path.join(directory, "source.pdf");
  await writeFile(pdfPath, input.bytes);
  const byNumber = new Map(input.index.map((page) => [page.pageNumber, page]));
  const output = [...input.index];
  const rejectedPages: Array<{ pageNumber: number; reason: string }> = [];
  try {
    for (const decision of input.decisions) {
      const nativePage = byNumber.get(decision.pageNumber);
      if (!nativePage || !eligible(nativePage)) continue;
      const prefix = path.join(directory, `page-${decision.pageNumber}`);
      await execFile("pdftoppm", ["-f", String(decision.pageNumber), "-l", String(decision.pageNumber), "-singlefile", "-r", String(OCR_DPI), "-png", pdfPath, prefix], { maxBuffer: 4_000_000 });
      const imagePath = `${prefix}.png`;
      const image = await readFile(imagePath);
      const dimensions = pngDimensions(image);
      const outputBase = path.join(directory, `ocr-${decision.pageNumber}`);
      await execFile("tesseract", [imagePath, outputBase, "-l", OCR_LANGUAGE, "--psm", String(OCR_PSM), "txt", "tsv"], { maxBuffer: 4_000_000 });
      const tsv = await readFile(`${outputBase}.tsv`, "utf8");
      const words = parseTsv(tsv);
      const tokens = tokensFromWords(words, nativePage, dimensions.width, dimensions.height);
      const text = textFromTokens(tokens);
      const confidences = words.map((word) => word.confidence);
      const numericConfidences = words.filter((word) => /\d/.test(word.text)).map((word) => word.confidence);
      const meanConfidence = mean(confidences) ?? 0;
      const numericMeanConfidence = mean(numericConfidences);
      if (meanConfidence < MIN_PAGE_CONFIDENCE || (numericMeanConfidence !== null && numericMeanConfidence < MIN_NUMERIC_CONFIDENCE)) {
        rejectedPages.push({ pageNumber: decision.pageNumber, reason: `OCR confidence below deterministic acceptance threshold (page=${meanConfidence.toFixed(4)}, numeric=${numericMeanConfidence?.toFixed(4) ?? "n/a"}).` });
        continue;
      }
      const imageHash = sha256(image);
      const metadata: P0AOcrSourceMetadata = {
        engine: runtime.engine,
        engineVersion: runtime.engineVersion,
        language: runtime.language,
        pageSegmentationMode: runtime.pageSegmentationMode,
        renderer: runtime.renderer,
        rendererVersion: runtime.rendererVersion,
        renderDpi: runtime.renderDpi,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
        pageImageHash: imageHash,
        ocrTextHash: sha256(text),
        wordCount: words.length,
        meanConfidence,
        numericMeanConfidence,
      };
      const layoutProjection = tokens.map(({ text: tokenText, x, y, width, height }) => [tokenText, x, y, width, height]);
      output[decision.pageNumber - 1] = {
        ...nativePage,
        text,
        normalizedText: text.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").trim(),
        textHash: sha256(text),
        layoutHash: sha256(JSON.stringify({ layoutProjection, pageImageHash: imageHash, engineVersion: runtime.engineVersion })),
        printedPageLabel: printedPageLabel(text),
        tokens,
        extractionStatus: "OCR_TEXT",
        contentClass: "IMAGE_ONLY",
        sourceType: "OCR",
        sourceMetadata: metadata,
      };
    }
    return { pages: output, runtime, rejectedPages };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
