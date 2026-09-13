import assert from "node:assert/strict";
import test from "node:test";
import { createPhase5FinalNativeExtractor } from "../../lib/financial/p0a/phase5-final-extractor";
import { routePages } from "../../lib/financial/p0a/page-router";
import type { P0AIndexedPage, P0AIssuerContext, P0APageToken, P0ARoutedPage } from "../../lib/financial/p0a/types";

const context: P0AIssuerContext = {
  ticker: "GENERIC", issuerType: "LISTED_COMMON_EQUITY", accountingModel: "NON_FINANCIAL", consolidated: true, audited: false,
  periodStart: "2025-01-01", periodEnd: "2025-06-30", periodType: "H1", currency: "USD", documentScale: "1",
};

function token(text: string, x: number, y: number): P0APageToken {
  return { text, x, y, width: Math.max(8, text.length * 3), height: 8, lineBreak: true };
}

test("explicit continuing-operations pretax subtotal remains a reported stated-scope fact", async () => {
  const text = [
    "INTERIM CONSOLIDATED STATEMENT OF PROFIT OR LOSS",
    "LABA SEBELUM PAJAK PENGHASILAN DARI OPERASI YANG DILANJUTKAN INCOME BEFORE TAX EXPENSE FROM CONTINUING OPERATIONS 182.471.257 350.771.100",
  ].join("\n");
  const page: P0ARoutedPage = {
    pageNumber: 8, width: 600, height: 800, text, normalizedText: text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    textHash: "a".repeat(64), layoutHash: "b".repeat(64), printedPageLabel: "5", tokens: [], extractionStatus: "NATIVE_TEXT",
    pageClass: "PRIMARY_INCOME_STATEMENT", statementType: "INCOME_STATEMENT", confidence: 1, matchedAnchors: ["statement of profit or loss"],
  };
  const extractor = createPhase5FinalNativeExtractor({ routedPages: [page], context });
  const facts = await extractor({ stage: "PRIMARY", route: "PRIMARY", selectedPages: [8], requirementIds: ["PRETAX_PROFIT_REPORTED"], cacheKey: "pretax-stated-scope" }, [page]);
  const fact = facts.find((item) => item.requirementId === "PRETAX_PROFIT_REPORTED");
  assert.equal(fact?.state, "VALUE");
  assert.equal(fact?.decimalValue, "182471257");
  assert.match(fact?.rawLabel ?? "", /CONTINUING OPERATIONS/i);
});

test("EPS calculation continuation page is targeted even without repeated note masthead", () => {
  const text = "2025 Laba per saham dasar Basic earnings per share Rata-rata Tertimbang Saham Biasa yang Beredar Weighted Average Number of Ordinary Outstanding Share 24.766.734.214 0,00150";
  const page: P0AIndexedPage = {
    pageNumber: 218, width: 600, height: 800, text, normalizedText: text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    textHash: "c".repeat(64), layoutHash: "d".repeat(64), printedPageLabel: "215", tokens: [token("2025", 40, 600), token("Laba per saham dasar Basic earnings per share", 40, 500), token("Rata-rata Tertimbang Saham Biasa yang Beredar Weighted Average Number of Ordinary Outstanding Share", 40, 450)], extractionStatus: "NATIVE_TEXT",
  };
  const routed = routePages([page]);
  assert.equal(routed[0].pageClass, "TARGETED_NOTE");
  assert.equal(routed[0].statementType, "NOTE");
  assert.deepEqual(routed[0].matchedAnchors, ["eps calculation table"]);
});
