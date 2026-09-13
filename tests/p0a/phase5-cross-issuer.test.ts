import assert from "node:assert/strict";
import test from "node:test";
import { createCrossIssuerNativeExtractor } from "../../lib/financial/p0a/cross-issuer-native-extractor";
import type { P0AIssuerContext, P0APageToken, P0ARoutedPage, P0AStatementType } from "../../lib/financial/p0a/types";

const usdContext: P0AIssuerContext = {
  ticker: "TEST", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL",
  consolidated: true, audited: false, periodStart: "2025-01-01", periodEnd: "2025-06-30",
  periodType: "H1", currency: "USD", documentScale: "1",
};

function token(text: string, x: number, y: number): P0APageToken {
  return { text, x, y, width: Math.max(6, text.length * 4), height: 8, lineBreak: false };
}

function statementPage(input: { statement: P0AStatementType; pageNumber?: number; rows: Array<[string, string, string]> }): P0ARoutedPage {
  const pageNumber = input.pageNumber ?? 1;
  const title = input.statement === "INCOME_STATEMENT" ? "INTERIM CONSOLIDATED STATEMENT OF PROFIT OR LOSS"
    : input.statement === "BALANCE_SHEET" ? "INTERIM CONSOLIDATED STATEMENT OF FINANCIAL POSITION"
      : input.statement === "CASH_FLOW" ? "INTERIM CONSOLIDATED STATEMENT OF CASH FLOWS"
        : "NOTES TO THE INTERIM CONSOLIDATED FINANCIAL STATEMENTS";
  const tokens: P0APageToken[] = [token(title, 40, 760), token("2025", 285, 710), token("2024", 390, 710)];
  input.rows.forEach(([label, current, comparative], index) => {
    const y = 660 - index * 35;
    tokens.push(token(label, 40, y), token(current, 280, y), token(comparative, 385, y));
  });
  const text = [title, "2025 2024", ...input.rows.map((row) => row.join(" "))].join("\n");
  return {
    pageNumber, width: 600, height: 800, text, normalizedText: text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    textHash: "a".repeat(64), layoutHash: "b".repeat(64), printedPageLabel: String(pageNumber), tokens, extractionStatus: "NATIVE_TEXT",
    pageClass: input.statement === "INCOME_STATEMENT" ? "PRIMARY_INCOME_STATEMENT"
      : input.statement === "BALANCE_SHEET" ? "PRIMARY_BALANCE_SHEET"
        : input.statement === "CASH_FLOW" ? "PRIMARY_CASH_FLOW" : "TARGETED_NOTE",
    statementType: input.statement, confidence: 1, matchedAnchors: [title.toLowerCase()],
  };
}

async function extract(page: P0ARoutedPage, requirementIds: string[]) {
  const extractor = createCrossIssuerNativeExtractor({ routedPages: [page], context: usdContext });
  return extractor({ stage: page.statementType === "NOTE" ? "TARGETED" : "PRIMARY", route: page.statementType === "NOTE" ? "NOTE" : "PRIMARY", selectedPages: [page.pageNumber], requirementIds, cacheKey: "phase5-test" }, [page]);
}

test("cross-issuer aliases preserve USD scale one for generic total revenue/cost/gross profit labels", async () => {
  const page = statementPage({ statement: "INCOME_STATEMENT", rows: [
    ["JUMLAH PENDAPATAN TOTAL REVENUES", "1.138.390.027", "1.165.368.521"],
    ["JUMLAH BEBAN POKOK PENDAPATAN DAN BIAYA LANGSUNG LAINNYA TOTAL COST OF REVENUES AND OTHER DIRECT COSTS", "702.600.099", "714.021.880"],
    ["LABA KOTOR GROSS PROFIT", "435.789.928", "451.346.641"],
  ] });
  const facts = await extract(page, ["REV_REPORTED", "COGS_REPORTED", "GROSS_PROFIT_REPORTED"]);
  const byId = new Map(facts.map((fact) => [fact.requirementId, fact]));
  assert.equal(byId.get("REV_REPORTED")?.decimalValue, "1138390027");
  assert.equal(byId.get("COGS_REPORTED")?.decimalValue, "702600099");
  assert.equal(byId.get("GROSS_PROFIT_REPORTED")?.decimalValue, "435789928");
  for (const fact of facts) {
    assert.equal(fact.currency, "USD");
    assert.equal(fact.scale, "1");
  }
});

test("inventory and PPE aliases are generic and do not require issuer-specific net wording", async () => {
  const page = statementPage({ statement: "BALANCE_SHEET", rows: [
    ["Persediaan Inventories", "155.743.076", "156.124.598"],
    ["Aset tetap Property plant and equipment", "109.862.248", "109.403.217"],
  ] });
  const facts = await extract(page, ["INV_REPORTED", "PPE_REPORTED"]);
  const byId = new Map(facts.map((fact) => [fact.requirementId, fact]));
  assert.equal(byId.get("INV_REPORTED")?.decimalValue, "155743076");
  assert.equal(byId.get("PPE_REPORTED")?.decimalValue, "109862248");
});

test("continuing-operations cash movement is not promoted to reported group NET_CHANGE_CASH", async () => {
  const page = statementPage({ statement: "CASH_FLOW", rows: [
    ["KENAIKAN NETO KAS DAN SETARA KAS DARI OPERASI YANG DILANJUTKAN NET INCREASE IN CASH AND CASH EQUIVALENTS FROM CONTINUING OPERATIONS", "187.114.688", "237.005.408"],
    ["PERBEDAAN NILAI TUKAR NETO NET FOREIGN EXCHANGE DIFFERENCE", "157.920", "(3.116.312)"],
  ] });
  const facts = await extract(page, ["NET_CHANGE_CASH_REPORTED", "FX_EFFECT_CASH_REPORTED"]);
  assert.equal(facts.some((fact) => fact.requirementId === "NET_CHANGE_CASH_REPORTED"), false);
  assert.equal(facts.find((fact) => fact.requirementId === "FX_EFFECT_CASH_REPORTED")?.decimalValue, "157920");
});

test("generic EPS note parsing obtains weighted-average shares and evidence-backed diluted N/A", async () => {
  const title = "NOTES TO THE INTERIM CONSOLIDATED FINANCIAL STATEMENTS";
  const tokens: P0APageToken[] = [
    token(title, 40, 760), token("30 Juni 2025 June 30 2025", 40, 710),
    token("Laba per saham dasar Basic earnings per share", 40, 650), token("37.188.257", 230, 650), token("24.766.734.214", 340, 650), token("0,00150", 470, 650),
  ];
  const paragraph = "Untuk periode enam bulan yang berakhir pada tanggal 30 Juni 2025, Perusahaan tidak menghitung laba per saham dilusian karena tidak terdapat saham biasa yang berpotensi dilutif. For the six-month period ended June 30, 2025, the Company did not calculate diluted earnings per share since there was no potentially dilutive ordinary shares.";
  const text = `${title}\n30 Juni 2025 June 30 2025\nLaba per saham dasar Basic earnings per share 37.188.257 24.766.734.214 0,00150\n${paragraph}`;
  const page: P0ARoutedPage = {
    pageNumber: 2, width: 600, height: 800, text, normalizedText: text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    textHash: "c".repeat(64), layoutHash: "d".repeat(64), printedPageLabel: "215", tokens, extractionStatus: "NATIVE_TEXT",
    pageClass: "TARGETED_NOTE", statementType: "NOTE", confidence: 1, matchedAnchors: ["notes"],
  };
  const facts = await extract(page, ["WEIGHTED_AVG_SHARES_REPORTED", "EPS_DILUTED_REPORTED"]);
  const shares = facts.find((fact) => fact.requirementId === "WEIGHTED_AVG_SHARES_REPORTED");
  const diluted = facts.find((fact) => fact.requirementId === "EPS_DILUTED_REPORTED");
  assert.equal(shares?.decimalValue, "24766734214");
  assert.equal(shares?.currency, "SHARES");
  assert.equal(shares?.scale, "1");
  assert.equal(diluted?.state, "NOT_APPLICABLE");
  assert.equal(diluted?.evidence.length, 1);
});

test("existing net-sales mapping remains unchanged for the ICBP-style label", async () => {
  const page = statementPage({ statement: "INCOME_STATEMENT", rows: [["PENJUALAN NETO NET SALES", "1.234.567", "999.999"]] });
  const facts = await extract(page, ["REV_REPORTED"]);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].decimalValue, "1234567");
  assert.equal(facts[0].origin, "REPORTED");
});
