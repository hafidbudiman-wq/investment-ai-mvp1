import assert from "node:assert/strict";
import test from "node:test";
import { createPhase5GenericNativeExtractor } from "../../lib/financial/p0a/phase5-generic-extractor";
import type { P0AIssuerContext, P0APageToken, P0ARoutedPage, P0AStatementType } from "../../lib/financial/p0a/types";

const context: P0AIssuerContext = {
  ticker: "GENERIC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false,
  periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "USD", documentScale: "1",
};

function tok(text: string, x: number, y: number): P0APageToken {
  return { text, x, y, width: Math.max(6, text.length * 4), height: 8, lineBreak: true };
}

function page(statementType: P0AStatementType, text: string, rows: Array<[string, string, string]>, pageNumber = 1): P0ARoutedPage {
  const title = statementType === "INCOME_STATEMENT" ? "CONSOLIDATED STATEMENT OF PROFIT OR LOSS"
    : statementType === "BALANCE_SHEET" ? "CONSOLIDATED STATEMENT OF FINANCIAL POSITION"
      : statementType === "CASH_FLOW" ? "CONSOLIDATED STATEMENT OF CASH FLOWS" : "NOTES TO THE CONSOLIDATED FINANCIAL STATEMENTS";
  const tokens: P0APageToken[] = [tok(title, 30, 760), tok("2025", 300, 710), tok("2024", 420, 710)];
  rows.forEach(([label, current, prior], i) => {
    const y = 650 - i * 35;
    tokens.push(tok(label, 30, y), tok(current, 300, y), tok(prior, 420, y));
  });
  return {
    pageNumber, width: 600, height: 800, text: `${title}\n2025 2024\n${text}`, normalizedText: text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    textHash: String(pageNumber).padStart(64, "a").slice(-64), layoutHash: String(pageNumber).padStart(64, "b").slice(-64), printedPageLabel: String(pageNumber), tokens,
    extractionStatus: "NATIVE_TEXT",
    pageClass: statementType === "INCOME_STATEMENT" ? "PRIMARY_INCOME_STATEMENT" : statementType === "BALANCE_SHEET" ? "PRIMARY_BALANCE_SHEET" : statementType === "CASH_FLOW" ? "PRIMARY_CASH_FLOW" : "TARGETED_NOTE",
    statementType, confidence: 1, matchedAnchors: [title.toLowerCase()],
  };
}

async function run(pages: P0ARoutedPage[], ids: string[], route: "PRIMARY" | "NOTE" = "PRIMARY") {
  const extractor = createPhase5GenericNativeExtractor({ routedPages: pages, context });
  return extractor({ stage: route === "NOTE" ? "TARGETED" : "PRIMARY", route, selectedPages: pages.map((item) => item.pageNumber), requirementIds: ids, cacheKey: "scope-safety" }, pages);
}

test("split continuing/discontinued presentation selects total group profit rather than continuing-only profit", async () => {
  const p = page("INCOME_STATEMENT",
    "OPERASI YANG DILANJUTKAN CONTINUING OPERATIONS\nLABA PERIODE/TAHUN BERJALAN DARI OPERASI YANG DILANJUTKAN 42.598.334 213.892.991 PROFIT FOR THE PERIOD/YEAR FROM CONTINUING OPERATIONS\nOPERASI YANG DIHENTIKAN DISCONTINUED OPERATIONS\nLABA PERIODE/TAHUN BERJALAN 42.420.559 212.618.589 PROFIT FOR THE PERIOD/YEAR",
    [["LABA PERIODE/TAHUN BERJALAN DARI OPERASI YANG DILANJUTKAN", "42.598.334", "213.892.991"], ["LABA PERIODE/TAHUN BERJALAN", "42.420.559", "212.618.589"]]);
  const facts = await run([p], ["NET_PROFIT_REPORTED"]);
  assert.equal(facts.filter((item) => item.requirementId === "NET_PROFIT_REPORTED").length, 1);
  assert.equal(facts.find((item) => item.requirementId === "NET_PROFIT_REPORTED")?.decimalValue, "42420559");
});

test("exact parent equity, NCI and total equity rows disambiguate nested total-equity labels", async () => {
  const text = [
    "Jumlah ekuitas yang dapat diatribusikan kepada pemilik entitas induk 2.071.197.306 2.118.726.151 Total equity attributable to equity holders of the parent company",
    "Kepentingan nonpengendali 30 233.475.996 232.305.418 Non-controlling interests",
    "Jumlah Ekuitas 2.304.673.302 2.351.031.569 Total Equity",
  ].join("\n");
  const p = page("BALANCE_SHEET", text, [
    ["Jumlah ekuitas yang dapat diatribusikan kepada pemilik entitas induk", "2.071.197.306", "2.118.726.151"],
    ["Kepentingan nonpengendali", "233.475.996", "232.305.418"],
    ["Jumlah Ekuitas", "2.304.673.302", "2.351.031.569"],
  ]);
  const facts = await run([p], ["EQUITY_PARENT_REPORTED", "NCI_REPORTED", "EQUITY_REPORTED"]);
  const byId = new Map(facts.map((item) => [item.requirementId, item]));
  assert.equal(byId.get("EQUITY_PARENT_REPORTED")?.decimalValue, "2071197306");
  assert.equal(byId.get("NCI_REPORTED")?.decimalValue, "233475996");
  assert.equal(byId.get("EQUITY_REPORTED")?.decimalValue, "2304673302");
});

test("treasury share count is read from the share-count label, not treasury-stock monetary rows", async () => {
  const p = page("BALANCE_SHEET",
    "- Saham treasuri\n453.229.508 saham pada tanggal 30 Juni 2025 dan 71.453.088 saham pada tanggal 31 Desember 2024 (2.196.148) (346.230) Treasury shares",
    [["Saham treasuri 453.229.508 saham pada tanggal 30 Juni 2025", "(2.196.148)", "(346.230)"]]);
  const facts = await run([p], ["TREASURY_SHARES_REPORTED"]);
  const treasury = facts.find((item) => item.requirementId === "TREASURY_SHARES_REPORTED");
  assert.equal(treasury?.decimalValue, "453229508");
  assert.equal(treasury?.currency, "SHARES");
  assert.equal(treasury?.scale, "1");
});
