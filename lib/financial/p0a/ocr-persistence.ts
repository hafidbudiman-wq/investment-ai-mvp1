import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { persistP0AShadowResult } from "@/lib/financial/p0a/persistence";
import type { P0AIssuerContext, P0AIndexedPage, P0AOcrSourceMetadata } from "@/lib/financial/p0a/types";
import type { P0APipelineResult } from "@/lib/financial/p0a/pipeline";

const REPRESENTATION_VERSION = "p0a-page-representation-v2";

type StoredPageRepresentation = {
  representationVersion: typeof REPRESENTATION_VERSION;
  sourceType: "NATIVE" | "OCR";
  contentClass: P0AIndexedPage["contentClass"];
  sourceMetadata: P0AOcrSourceMetadata | null;
  tokens: P0AIndexedPage["tokens"];
};

function storedRepresentation(page: P0AIndexedPage): StoredPageRepresentation {
  return {
    representationVersion: REPRESENTATION_VERSION,
    sourceType: page.sourceType ?? "NATIVE",
    contentClass: page.contentClass ?? (page.text ? "NATIVE_TEXT" : "IMAGE_ONLY"),
    sourceMetadata: page.sourceMetadata ?? null,
    tokens: page.tokens,
  };
}

function parseStoredTokens(value: unknown): Pick<P0AIndexedPage, "tokens" | "sourceType" | "contentClass" | "sourceMetadata"> | null {
  if (Array.isArray(value)) {
    return { tokens: value as P0AIndexedPage["tokens"], sourceType: "NATIVE", contentClass: undefined, sourceMetadata: null };
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StoredPageRepresentation>;
  if (record.representationVersion !== REPRESENTATION_VERSION || !Array.isArray(record.tokens)) return null;
  return {
    tokens: record.tokens as P0AIndexedPage["tokens"],
    sourceType: record.sourceType === "OCR" ? "OCR" : "NATIVE",
    contentClass: record.contentClass,
    sourceMetadata: record.sourceMetadata ?? null,
  };
}

export async function loadCachedP0ACompatiblePageIndex(client: PrismaClient, documentId: string, parserVersion: string): Promise<P0AIndexedPage[] | null> {
  const rows = await client.p0ADocumentPage.findMany({ where: { documentId, parserVersion }, orderBy: { pageNumber: "asc" } });
  if (!rows.length || rows.some((row, index) => row.pageNumber !== index + 1)) return null;
  const parsed = rows.map((row) => parseStoredTokens(row.tokens));
  if (parsed.some((item) => item === null)) return null;
  return rows.map((row, index) => {
    const representation = parsed[index]!;
    return {
      pageNumber: row.pageNumber,
      width: row.pageWidth,
      height: row.pageHeight,
      text: row.text,
      normalizedText: row.text.normalize("NFKC").replace(/\u00a0/g, " ").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").trim(),
      textHash: row.textHash,
      layoutHash: row.layoutHash,
      printedPageLabel: row.printedPageLabel,
      tokens: representation.tokens,
      extractionStatus: row.extractionStatus as P0AIndexedPage["extractionStatus"],
      sourceType: representation.sourceType,
      contentClass: representation.contentClass ?? (row.text ? "NATIVE_TEXT" : "IMAGE_ONLY"),
      sourceMetadata: representation.sourceMetadata,
    };
  });
}

/**
 * Uses the existing P0-A persistence transaction, then enriches only OCR page
 * cache rows with representation provenance inside the existing JSON column.
 * No canonical schema or legacy financial tables are changed.
 */
export async function persistP0ACompatibleResult(
  client: PrismaClient,
  input: { documentId: string; companyId: string; jobId?: string; context: P0AIssuerContext; result: P0APipelineResult },
) {
  const persisted = await persistP0AShadowResult(client, input);
  for (const page of input.result.routedPages.filter((item) => item.sourceType === "OCR")) {
    await client.p0ADocumentPage.update({
      where: { documentId_pageNumber_parserVersion: { documentId: input.documentId, pageNumber: page.pageNumber, parserVersion: input.result.versions.parser } },
      data: { tokens: storedRepresentation(page) as unknown as Prisma.InputJsonValue },
    });
  }
  return persisted;
}
