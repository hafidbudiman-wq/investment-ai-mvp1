import type { P0AIndexedPage, P0APageClass, P0ARequirement, P0ARoutedPage, P0AStatementType } from "@/lib/financial/p0a/types";

const PRIMARY_RULES: Array<{ pageClass: P0APageClass; statementType: P0AStatementType; anchors: string[] }> = [
  { pageClass: "PRIMARY_BALANCE_SHEET", statementType: "BALANCE_SHEET", anchors: ["laporan posisi keuangan", "statement of financial position"] },
  { pageClass: "PRIMARY_INCOME_STATEMENT", statementType: "INCOME_STATEMENT", anchors: ["laporan laba rugi", "statement of profit or loss"] },
  { pageClass: "PRIMARY_CHANGES_IN_EQUITY", statementType: "CHANGES_IN_EQUITY", anchors: ["laporan perubahan ekuitas", "statement of changes in equity"] },
  { pageClass: "PRIMARY_CASH_FLOW", statementType: "CASH_FLOW", anchors: ["laporan arus kas", "statement of cash flows"] },
];

const NOTE_MARKERS = ["catatan atas laporan", "notes to the"] as const;

function countAnchor(text: string, anchor: string): number {
  let count = 0;
  let cursor = 0;
  while ((cursor = text.indexOf(anchor, cursor)) >= 0) {
    count += 1;
    cursor += anchor.length;
  }
  return count;
}

function earliest(text: string, anchors: readonly string[]): number | null {
  const positions = anchors.map((anchor) => text.indexOf(anchor)).filter((position) => position >= 0);
  return positions.length ? Math.min(...positions) : null;
}

function classify(page: P0AIndexedPage): Omit<P0ARoutedPage, keyof P0AIndexedPage> {
  const text = page.normalizedText;
  const structuralWindow = text.slice(0, 6_000);
  const notePosition = earliest(structuralWindow, NOTE_MARKERS);

  const primaryMatches = PRIMARY_RULES.flatMap((rule) => rule.anchors.map((anchor) => ({ rule, anchor, position: structuralWindow.indexOf(anchor) })))
    .filter((match) => match.position >= 0)
    .sort((left, right) => left.position - right.position);
  const firstPrimary = primaryMatches[0] ?? null;

  // Use reading-order structure rather than broad page presence. Primary
  // statements mention accompanying notes in their footer; note pages often
  // quote primary-statement names in their body. The structural marker that
  // appears first therefore identifies the actual page role without relying
  // on issuer, page number, or PDF coordinate orientation.
  if (notePosition !== null && (!firstPrimary || notePosition < firstPrimary.position)) {
    return { pageClass: "TARGETED_NOTE", statementType: "NOTE", confidence: 0.995, matchedAnchors: ["notes masthead"] };
  }

  const toc = ["daftar isi", "table of contents"].filter((anchor) => structuralWindow.includes(anchor));
  if (toc.length) return { pageClass: "TABLE_OF_CONTENTS", statementType: "OTHER", confidence: 0.99, matchedAnchors: toc };

  const auditor = ["laporan auditor independen", "independent auditor s report"].filter((anchor) => structuralWindow.includes(anchor));
  if (auditor.length) return { pageClass: "AUDITOR_REPORT", statementType: "OTHER", confidence: 0.99, matchedAnchors: auditor };

  if (firstPrimary) {
    const sameRuleAnchors = firstPrimary.rule.anchors.filter((anchor) => structuralWindow.includes(anchor));
    return { pageClass: firstPrimary.rule.pageClass, statementType: firstPrimary.rule.statementType, confidence: 0.99, matchedAnchors: sameRuleAnchors };
  }

  if (notePosition !== null) return { pageClass: "TARGETED_NOTE", statementType: "NOTE", confidence: 0.98, matchedAnchors: ["notes masthead"] };
  return { pageClass: "OTHER", statementType: "OTHER", confidence: page.text ? 0.7 : 1, matchedAnchors: [] };
}

export function routePages(index: readonly P0AIndexedPage[]): P0ARoutedPage[] {
  return index.map((page) => ({ ...page, ...classify(page) }));
}

export function primaryPages(routed: readonly P0ARoutedPage[]): number[] {
  return routed.filter((page) => page.pageClass.startsWith("PRIMARY_")).map((page) => page.pageNumber);
}

function targetedScore(page: P0ARoutedPage, requirement: P0ARequirement): { anchorScore: number; score: number } {
  const anchorScore = requirement.targetedAnchors.reduce((sum, anchor) => sum + countAnchor(page.normalizedText, anchor), 0);
  if (anchorScore === 0) return { anchorScore, score: 0 };

  if (requirement.id === "WEIGHTED_AVG_SHARES_REPORTED") {
    const scoped = /(?:continuing operations?|discontinued operations?|operasi yang dilanjutkan|operasi yang dihentikan)/.test(page.normalizedText);
    return { anchorScore, score: anchorScore - (scoped ? 1_000 : 0) };
  }
  return { anchorScore, score: anchorScore };
}

export function selectTargetedPages(
  routed: readonly P0ARoutedPage[],
  requirements: readonly P0ARequirement[],
): Map<string, number[]> {
  const notePages = routed.filter((page) => page.pageClass === "TARGETED_NOTE");
  const selected = new Map<string, number[]>();
  for (const requirement of requirements) {
    if (!requirement.targetedAnchors.length) continue;
    const candidates = notePages.map((page) => ({ page: page.pageNumber, ...targetedScore(page, requirement) }))
      .filter((candidate) => candidate.anchorScore > 0)
      .sort((left, right) => right.score - left.score || right.anchorScore - left.anchorScore || left.page - right.page);
    if (candidates.length) selected.set(requirement.id, [candidates[0].page]);
  }
  return selected;
}
