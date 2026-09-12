import type { P0AIndexedPage, P0APageClass, P0ARequirement, P0ARoutedPage, P0AStatementType } from "@/lib/financial/p0a/types";

const PRIMARY_RULES: Array<{ pageClass: P0APageClass; statementType: P0AStatementType; anchors: string[] }> = [
  { pageClass: "PRIMARY_BALANCE_SHEET", statementType: "BALANCE_SHEET", anchors: ["laporan posisi keuangan", "statement of financial position"] },
  { pageClass: "PRIMARY_INCOME_STATEMENT", statementType: "INCOME_STATEMENT", anchors: ["laporan laba rugi", "statement of profit or loss"] },
  { pageClass: "PRIMARY_CHANGES_IN_EQUITY", statementType: "CHANGES_IN_EQUITY", anchors: ["laporan perubahan ekuitas", "statement of changes in equity"] },
  { pageClass: "PRIMARY_CASH_FLOW", statementType: "CASH_FLOW", anchors: ["laporan arus kas", "statement of cash flows"] },
];

function countAnchor(text: string, anchor: string): number {
  let count = 0;
  let cursor = 0;
  while ((cursor = text.indexOf(anchor, cursor)) >= 0) {
    count += 1;
    cursor += anchor.length;
  }
  return count;
}

function classify(page: P0AIndexedPage): Omit<P0ARoutedPage, keyof P0AIndexedPage> {
  const header = page.normalizedText.slice(0, 4_500);
  // Notes frequently quote primary-statement names.  Detect the actual,
  // upper-case note-page masthead before considering those body references.
  const noteMasthead = /(?:CATATAN ATAS LAPORAN KEUANGAN|NOTES TO THE (?:INTERIM )?CONSOLIDATED)[\s\S]{0,120}(?:KONSOLIDASIAN|FINANCIAL STATEMENTS)/.test(page.text.slice(0, 900));
  if (noteMasthead) {
    return { pageClass: "TARGETED_NOTE", statementType: "NOTE", confidence: 0.99, matchedAnchors: ["notes masthead"] };
  }
  const toc = ["daftar isi", "table of contents"].filter((anchor) => header.includes(anchor));
  if (toc.length) return { pageClass: "TABLE_OF_CONTENTS", statementType: "OTHER", confidence: 0.99, matchedAnchors: toc };

  const auditor = ["laporan auditor independen", "independent auditor s report"].filter((anchor) => header.includes(anchor));
  if (auditor.length) return { pageClass: "AUDITOR_REPORT", statementType: "OTHER", confidence: 0.99, matchedAnchors: auditor };

  for (const rule of PRIMARY_RULES) {
    const matches = rule.anchors.filter((anchor) => header.includes(anchor));
    if (matches.length) return { pageClass: rule.pageClass, statementType: rule.statementType, confidence: 0.99, matchedAnchors: matches };
  }

  const noteAnchors = ["catatan atas laporan keuangan", "notes to the interim consolidated financial statements", "notes to the consolidated financial statements"];
  const notes = noteAnchors.filter((anchor) => header.includes(anchor));
  if (notes.length) return { pageClass: "TARGETED_NOTE", statementType: "NOTE", confidence: 0.98, matchedAnchors: notes };
  return { pageClass: "OTHER", statementType: "OTHER", confidence: page.text ? 0.7 : 1, matchedAnchors: [] };
}

export function routePages(index: readonly P0AIndexedPage[]): P0ARoutedPage[] {
  return index.map((page) => ({ ...page, ...classify(page) }));
}

export function primaryPages(routed: readonly P0ARoutedPage[]): number[] {
  return routed.filter((page) => page.pageClass.startsWith("PRIMARY_")).map((page) => page.pageNumber);
}

export function selectTargetedPages(
  routed: readonly P0ARoutedPage[],
  requirements: readonly P0ARequirement[],
): Map<string, number[]> {
  const notePages = routed.filter((page) => page.pageClass === "TARGETED_NOTE");
  const selected = new Map<string, number[]>();
  for (const requirement of requirements) {
    if (!requirement.targetedAnchors.length) continue;
    const candidates = notePages.map((page) => ({
      page: page.pageNumber,
      score: requirement.targetedAnchors.reduce((sum, anchor) => sum + countAnchor(page.normalizedText, anchor), 0),
    })).filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.page - right.page);
    if (candidates.length) selected.set(requirement.id, [candidates[0].page]);
  }
  return selected;
}
