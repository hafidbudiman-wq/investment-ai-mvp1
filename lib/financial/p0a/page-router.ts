import type { P0AIndexedPage, P0APageClass, P0ARequirement, P0ARoutedPage, P0AStatementType } from "@/lib/financial/p0a/types";

const PRIMARY_RULES: Array<{ pageClass: P0APageClass; statementType: P0AStatementType; anchors: string[] }> = [
  { pageClass: "PRIMARY_BALANCE_SHEET", statementType: "BALANCE_SHEET", anchors: ["laporan posisi keuangan", "statement of financial position"] },
  { pageClass: "PRIMARY_INCOME_STATEMENT", statementType: "INCOME_STATEMENT", anchors: ["laporan laba rugi", "statement of profit or loss"] },
  { pageClass: "PRIMARY_CHANGES_IN_EQUITY", statementType: "CHANGES_IN_EQUITY", anchors: ["laporan perubahan ekuitas", "statement of changes in equity"] },
  { pageClass: "PRIMARY_CASH_FLOW", statementType: "CASH_FLOW", anchors: ["laporan arus kas", "statement of cash flows"] },
];

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, " ").replace(/\s+/g, " ").trim();
}

function countAnchor(text: string, anchor: string): number {
  let count = 0;
  let cursor = 0;
  while ((cursor = text.indexOf(anchor, cursor)) >= 0) { count += 1; cursor += anchor.length; }
  return count;
}

function edgeRegions(page: P0AIndexedPage): string[] {
  if (!page.tokens.length) return [page.normalizedText.slice(0, 1_200)];
  const low = page.height * 0.15;
  const high = page.height * 0.85;
  const lowEdge = normalize(page.tokens.filter((token) => token.y <= low).map((token) => token.text).join(" "));
  const highEdge = normalize(page.tokens.filter((token) => token.y >= high).map((token) => token.text).join(" "));
  return [lowEdge, highEdge].filter(Boolean);
}

function noteMasthead(page: P0AIndexedPage): boolean {
  return edgeRegions(page).some((edge) => {
    const noteIdentity = (edge.includes("catatan") && edge.includes("laporan") && edge.includes("keuangan"))
      || (edge.includes("notes") && edge.includes("financial") && edge.includes("statements"));
    const periodIdentity = edge.includes("tanggal") || edge.includes("as of") || edge.includes("periode") || edge.includes("period ended") || edge.includes("year ended");
    return noteIdentity && periodIdentity;
  });
}

function epsCalculationPage(text: string): boolean {
  const basic = text.includes("basic earnings per share") || text.includes("laba per saham dasar");
  const weighted = text.includes("weighted average number of shares")
    || text.includes("weighted average number of ordinary outstanding share")
    || text.includes("jumlah rata rata tertimbang saham")
    || text.includes("rata rata tertimbang saham biasa yang beredar");
  return basic && weighted;
}

function classify(page: P0AIndexedPage): Omit<P0ARoutedPage, keyof P0AIndexedPage> {
  const header = page.normalizedText.slice(0, 6_000);
  if (noteMasthead(page)) {
    return { pageClass: "TARGETED_NOTE", statementType: "NOTE", confidence: 0.995, matchedAnchors: ["notes masthead"] };
  }

  const toc = ["daftar isi", "table of contents"].filter((anchor) => header.includes(anchor));
  if (toc.length) return { pageClass: "TABLE_OF_CONTENTS", statementType: "OTHER", confidence: 0.99, matchedAnchors: toc };
  const auditor = ["laporan auditor independen", "independent auditor s report"].filter((anchor) => header.includes(anchor));
  if (auditor.length) return { pageClass: "AUDITOR_REPORT", statementType: "OTHER", confidence: 0.99, matchedAnchors: auditor };

  for (const rule of PRIMARY_RULES) {
    const matches = rule.anchors.filter((anchor) => header.includes(anchor));
    if (matches.length) return { pageClass: rule.pageClass, statementType: rule.statementType, confidence: 0.99, matchedAnchors: matches };
  }

  // Some issuers repeat the note masthead only on the first page of a note.
  // A continuation page containing both an EPS calculation label and its
  // weighted-average denominator is still a deterministic targeted-note page.
  if (epsCalculationPage(page.normalizedText)) {
    return { pageClass: "TARGETED_NOTE", statementType: "NOTE", confidence: 0.98, matchedAnchors: ["eps calculation table"] };
  }

  const noteAnchors = ["catatan atas laporan keuangan", "notes to the interim consolidated financial statements", "notes to the consolidated financial statements"];
  const notes = noteAnchors.filter((anchor) => header.includes(anchor));
  if (notes.length) return { pageClass: "TARGETED_NOTE", statementType: "NOTE", confidence: 0.98, matchedAnchors: notes };
  return { pageClass: "OTHER", statementType: "OTHER", confidence: page.text ? 0.7 : 1, matchedAnchors: [] };
}

export function routePages(index: readonly P0AIndexedPage[]): P0ARoutedPage[] { return index.map((page) => ({ ...page, ...classify(page) })); }
export function primaryPages(routed: readonly P0ARoutedPage[]): number[] { return routed.filter((page) => page.pageClass.startsWith("PRIMARY_")).map((page) => page.pageNumber); }

function targetedScore(page: P0ARoutedPage, requirement: P0ARequirement): { anchorScore: number; score: number } {
  const anchorScore = requirement.targetedAnchors.reduce((sum, anchor) => sum + countAnchor(page.normalizedText, anchor), 0);
  if (anchorScore === 0) return { anchorScore, score: 0 };
  if (requirement.id === "WEIGHTED_AVG_SHARES_REPORTED") {
    const scoped = /(?:continuing operations?|discontinued operations?|operasi yang dilanjutkan|operasi yang dihentikan)/.test(page.normalizedText);
    return { anchorScore, score: anchorScore - (scoped ? 1_000 : 0) };
  }
  return { anchorScore, score: anchorScore };
}

export function selectTargetedPages(routed: readonly P0ARoutedPage[], requirements: readonly P0ARequirement[]): Map<string, number[]> {
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
