import { createHash } from "node:crypto";
import type { P0AEvidence, P0AIndexedPage } from "@/lib/financial/p0a/types";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export function createEvidence(input: {
  requirementId: string;
  page: P0AIndexedPage;
  statement: string;
  table?: string | null;
  rowLabel: string;
  columnLabel: string;
  rawValue: string;
  snippet: string;
}): P0AEvidence {
  if (!input.page.text.includes(input.snippet)) throw new Error(`Evidence snippet is not present on PDF page ${input.page.pageNumber}.`);
  const locator = [input.page.pageNumber, input.statement, input.table ?? "", input.rowLabel, input.columnLabel, input.rawValue].join("|");
  return {
    requirementId: input.requirementId,
    pageNumber: input.page.pageNumber,
    printedPageLabel: input.page.printedPageLabel,
    statement: input.statement,
    table: input.table ?? null,
    rowLabel: input.rowLabel,
    columnLabel: input.columnLabel,
    rawValue: input.rawValue,
    snippet: input.snippet,
    snippetHash: sha(input.snippet),
    evidenceHash: sha([input.requirementId, locator, input.snippet].join("|")),
    locatorHash: sha(locator),
  };
}

export function assertEvidenceComplete(evidence: P0AEvidence): void {
  if (evidence.pageNumber < 1 || !evidence.rowLabel || !evidence.columnLabel || !evidence.rawValue || !evidence.snippetHash || !evidence.locatorHash) {
    throw new Error(`Incomplete lineage for ${evidence.requirementId}.`);
  }
}
