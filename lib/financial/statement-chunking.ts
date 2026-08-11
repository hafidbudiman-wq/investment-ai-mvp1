import { createHash } from "node:crypto";
import { normalizeCurrency, normalizeUnitScale } from "@/lib/financial/normalization";

export type StatementKind = "BALANCE_SHEET" | "INCOME_STATEMENT" | "CASH_FLOW" | "NOTES" | "OTHER";
export type ExtractedPage = { pageNumber: number; text: string };
export type StructureAwareChunk = {
  ordinal: number;
  chunkType: "SECTION" | "TABLE";
  statementType: StatementKind;
  pageStart: number;
  pageEnd: number;
  sourceText: string;
  tableContext: string;
  unitScale: number | null;
  currency: string | null;
  extractionMethod: "NATIVE_TEXT" | "OCR" | "HYBRID";
  confidence: number;
  checksum: string;
};

const HEADINGS: Array<{ type: StatementKind; pattern: RegExp }> = [
  { type: "BALANCE_SHEET", pattern: /(?:laporan posisi keuangan|statement of financial position|neraca)/i },
  { type: "INCOME_STATEMENT", pattern: /(?:laporan laba rugi|statement of profit or loss|income statement)/i },
  { type: "CASH_FLOW", pattern: /(?:laporan arus kas|statement of cash flows?)/i },
  { type: "NOTES", pattern: /(?:catatan atas laporan keuangan|notes to the financial statements)/i },
];

function headingType(line: string): StatementKind | null {
  return HEADINGS.find((heading) => heading.pattern.test(line))?.type ?? null;
}

function checksum(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function contextFor(text: string, type: StatementKind) {
  const line = text.split("\n").map((value) => value.trim()).find(Boolean);
  return line?.slice(0, 500) || type;
}

function splitPage(page: ExtractedPage, carriedType: StatementKind): Array<{ type: StatementKind; text: string }> {
  const lines = page.text.split("\n");
  const boundaries = lines
    .map((line, index) => ({ index, type: headingType(line) }))
    .filter((item): item is { index: number; type: StatementKind } => item.type !== null);

  if (!boundaries.length) return [{ type: carriedType, text: page.text.trim() }].filter((part) => part.text);
  if (boundaries[0].index > 0 && lines.slice(0, boundaries[0].index).join("").trim()) {
    if (carriedType === "OTHER") boundaries[0] = { ...boundaries[0], index: 0 };
    else boundaries.unshift({ index: 0, type: carriedType });
  }

  return boundaries.map((boundary, index) => ({
    type: boundary.type,
    text: lines.slice(boundary.index, boundaries[index + 1]?.index ?? lines.length).join("\n").trim(),
  })).filter((part) => part.text);
}

export function createStructureAwareChunks(
  pages: readonly ExtractedPage[],
  extractionMethod: StructureAwareChunk["extractionMethod"] = "NATIVE_TEXT",
): StructureAwareChunk[] {
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  if (sorted.some((page, index) => page.pageNumber < 1 || (index > 0 && page.pageNumber === sorted[index - 1].pageNumber))) throw new Error("PDF pages must have unique positive page numbers.");

  const drafts: Array<Omit<StructureAwareChunk, "ordinal" | "checksum">> = [];
  let carriedType: StatementKind = "OTHER";
  for (const page of sorted) {
    for (const section of splitPage(page, carriedType)) {
      carriedType = section.type;
      const previous = drafts.at(-1);
      if (previous && previous.statementType === section.type && previous.pageEnd + 1 === page.pageNumber) {
        previous.pageEnd = page.pageNumber;
        previous.sourceText = `${previous.sourceText}\n\f\n${section.text}`;
        previous.unitScale ??= normalizeUnitScale(section.text);
        previous.currency ??= normalizeCurrency(section.text.match(/(?:IDR|USD|US\$|Rp|Rupiah)/i)?.[0]);
        continue;
      }
      drafts.push({
        chunkType: /\s{2,}\S/.test(section.text) ? "TABLE" : "SECTION",
        statementType: section.type,
        pageStart: page.pageNumber,
        pageEnd: page.pageNumber,
        sourceText: section.text,
        tableContext: contextFor(section.text, section.type),
        unitScale: normalizeUnitScale(section.text),
        currency: normalizeCurrency(section.text.match(/(?:IDR|USD|US\$|Rp|Rupiah)/i)?.[0]),
        extractionMethod,
        confidence: section.type === "OTHER" ? 0.55 : extractionMethod === "OCR" ? 0.72 : 0.9,
      });
    }
  }

  return drafts.map((draft, ordinal) => ({ ...draft, ordinal, checksum: checksum(draft.sourceText) }));
}

/** Native parsing is only preferred when it actually identifies the three
 * primary financial-statement structures. Otherwise the AI's page-traced
 * chunks are safer than a giant OTHER chunk produced by a difficult PDF font.
 */
export function hasReliableNativeStatementStructure(chunks: readonly StructureAwareChunk[]) {
  const primary = new Set(chunks.map((chunk) => chunk.statementType).filter((type) =>
    type === "BALANCE_SHEET" || type === "INCOME_STATEMENT" || type === "CASH_FLOW",
  ));
  return primary.size >= 2 && chunks.some((chunk) => chunk.statementType !== "OTHER");
}
