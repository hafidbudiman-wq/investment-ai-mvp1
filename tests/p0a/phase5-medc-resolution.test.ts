import assert from "node:assert/strict";
import test from "node:test";
import { createPhase5AcceptanceNativeExtractor } from "../../lib/financial/p0a/phase5-acceptance-extractor";
import { routePages, selectTargetedPages } from "../../lib/financial/p0a/page-router";
import { P0A_REQUIREMENT_BY_ID } from "../../lib/financial/p0a/requirements";
import type { P0AIndexedPage, P0AIssuerContext, P0APageToken, P0ARoutedPage, P0AStatementType } from "../../lib/financial/p0a/types";

const context: P0AIssuerContext = {
  ticker: "GENERIC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false,
  periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "USD", documentScale: "1",
};

function tok(text: string, x: number, y: number): P0APageToken {
  return { text, x, y, width: Math.max(8, text.length * 3.2), height: 8, lineBreak: true };
}

function statementPage(statementType: P0AStatementType, rows: Array<[string, string, string]>, pageNumber = 1): P0ARoutedPage {
  const title = statementType === "INCOME_STATEMENT" ? "INTERIM CONSOLIDATED STATEMENT OF PROFIT OR LOSS"
    : statementType === "BALANCE_SHEET" ? "INTERIM CONSOLIDATED STATEMENT OF FINANCIAL POSITION"
      : "INTERIM CONSOLIDATED STATEMENT OF CASH FLOWS";
  const tokens: P0APageToken[] = [tok(title, 40, 760), tok("2025", 300, 710), tok("2024", 420, 710)];
  rows.forEach(([label, current, prior], index) => {
    const y = 650 - index * 34;
    tokens.push(tok(label, 40, y), tok(current, 300, y), tok(prior, 420, y));
  });
  const text = [title, "2025 2024", ...rows.map((row) => row.join(" "))].join("\n");
  return {
    pageNumber, width: 600, height: 800, text, normalizedText: text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    textHash: String(pageNumber).padStart(64, "a").slice(-64), layoutHash: String(pageNumber).padStart(64, "b").slice(-64), printedPageLabel: String(pageNumber), tokens,
    extractionStatus: "NATIVE_TEXT",
    pageClass: statementType === "INCOME_STATEMENT" ? "PRIMARY_INCOME_STATEMENT" : statementType === "BALANCE_SHEET" ? "PRIMARY_BALANCE_SHEET" : "PRIMARY_CASH_FLOW",
    statementType, confidence: 1, matchedAnchors: [title.toLowerCase()],
  };
}

async function run(pages: P0ARoutedPage[], ids: string[]) {
  const extractor = createPhase5AcceptanceNativeExtractor({ routedPages: pages, context });
  return extractor({ stage: "PRIMARY", route: "PRIMARY", selectedPages: pages.map((page) => page.pageNumber), requirementIds: ids, cacheKey: "phase5-medc-resolution" }, pages);
}

test("continuing-operation pretax and tax rows remain reported with their stated scope", async () => {
  const page = statementPage("INCOME_STATEMENT", [
    ["JUMLAH PENDAPATAN TOTAL REVENUES", "1.138.390.027", "1.165.368.521"],
    ["LABA SEBELUM PAJAK PENGHASILAN DARI OPERASI YANG DILANJUTKAN INCOME BEFORE TAX EXPENSE FROM CONTINUING OPERATIONS", "182.471.257", "350.771.100"],
    ["BEBAN PAJAK PENGHASILAN INCOME TAX EXPENSE", "(139.872.923)", "(136.878.109)"],
    ["LABA PERIODE TAHUN BERJALAN PROFIT FOR THE PERIOD YEAR", "42.420.559", "212.618.589"],
  ]);
  const facts = await run([page], ["PRETAX_PROFIT_REPORTED", "TAX_EXPENSE_REPORTED"]);
  const byId = new Map(facts.map((fact) => [fact.requirementId, fact]));
  assert.equal(byId.get("PRETAX_PROFIT_REPORTED")?.decimalValue, "182471257");
  assert.equal(byId.get("TAX_EXPENSE_REPORTED")?.decimalValue, "-139872923");
  assert.match(byId.get("PRETAX_PROFIT_REPORTED")?.rawLabel ?? "", /CONTINUING OPERATIONS/i);
});

test("complete P&L without issuer-defined operating profit produces explicit NOT_DISCLOSED", async () => {
  const page = statementPage("INCOME_STATEMENT", [
    ["JUMLAH PENDAPATAN TOTAL REVENUES", "1.138.390.027", "1.165.368.521"],
    ["LABA KOTOR GROSS PROFIT", "435.789.928", "451.346.641"],
    ["LABA SEBELUM PAJAK PENGHASILAN INCOME BEFORE TAX", "182.471.257", "350.771.100"],
    ["LABA PERIODE TAHUN BERJALAN PROFIT FOR THE PERIOD YEAR", "42.420.559", "212.618.589"],
  ]);
  const facts = await run([page], ["OPERATING_PROFIT_REPORTED"]);
  assert.equal(facts.find((fact) => fact.requirementId === "OPERATING_PROFIT_REPORTED")?.state, "NOT_DISCLOSED");
});

test("scoped continuing/discontinued cash movements are not promoted to group net-change cash", async () => {
  const page = statementPage("CASH_FLOW", [
    ["NET INCREASE IN CASH AND CASH EQUIVALENTS FROM CONTINUING OPERATIONS", "187.114.688", "237.005.408"],
    ["NET DECREASE IN CASH AND CASH EQUIVALENTS FROM DISCONTINUED OPERATIONS", "(9.781)", "(3.933.466)"],
    ["NET FOREIGN EXCHANGE DIFFERENCE", "157.920", "(3.116.312)"],
  ]);
  const facts = await run([page], ["NET_CHANGE_CASH_REPORTED"]);
  const fact = facts.find((item) => item.requirementId === "NET_CHANGE_CASH_REPORTED");
  assert.equal(fact?.state, "NOT_DISCLOSED");
  assert.equal(fact?.decimalValue, null);
});

test("physical note masthead wins over quoted primary-statement names", () => {
  const tokens = [
    tok("PT TEST", 40, 780), tok("CATATAN ATAS LAPORAN", 40, 750), tok("KEUANGAN KONSOLIDASIAN INTERIM", 40, 730),
    tok("NOTES TO THE INTERIM CONSOLIDATED", 320, 750), tok("FINANCIAL STATEMENTS", 320, 730),
    tok("statement of profit or loss", 40, 300), tok("statement of cash flows", 40, 260),
  ];
  const text = tokens.map((token) => token.text).join("\n");
  const page: P0AIndexedPage = {
    pageNumber: 26, width: 600, height: 800, text, normalizedText: text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    textHash: "a".repeat(64), layoutHash: "b".repeat(64), printedPageLabel: "23", tokens, extractionStatus: "NATIVE_TEXT",
  };
  const routed = routePages([page]);
  assert.equal(routed[0].pageClass, "TARGETED_NOTE");
  assert.equal(routed[0].statementType, "NOTE");
});

test("weighted-average routing prefers total EPS table over scoped operation tables", () => {
  const base = (pageNumber: number, text: string): P0ARoutedPage => ({
    pageNumber, width: 600, height: 800, text, normalizedText: text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    textHash: String(pageNumber).padStart(64, "a").slice(-64), layoutHash: String(pageNumber).padStart(64, "b").slice(-64), printedPageLabel: String(pageNumber), tokens: [], extractionStatus: "NATIVE_TEXT",
    pageClass: "TARGETED_NOTE", statementType: "NOTE", confidence: 1, matchedAnchors: ["notes masthead"],
  });
  const pages = [
    base(218, "Laba per saham dasar Rata-rata Tertimbang Saham Biasa yang Beredar Weighted Average Number of Ordinary Outstanding Share"),
    base(219, "continuing operations Rata-rata Tertimbang Saham Biasa yang Beredar Weighted Average Number of Ordinary Outstanding Share discontinued operations Rata-rata Tertimbang Saham Biasa yang Beredar Weighted Average Number of Ordinary Outstanding Share"),
    base(220, "The weighted average number of shares takes into account treasury shares"),
  ];
  const requirement = P0A_REQUIREMENT_BY_ID.get("WEIGHTED_AVG_SHARES_REPORTED");
  assert.ok(requirement);
  const selected = selectTargetedPages(pages, [requirement]);
  assert.deepEqual(selected.get("WEIGHTED_AVG_SHARES_REPORTED"), [218]);
});
