import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { planOcrCompatibilityPages } from "../../lib/financial/p0a/ocr-compatibility";
import type { P0AIndexedPage, P0APageClass, P0ARoutedPage, P0AStatementType } from "../../lib/financial/p0a/types";

function indexed(pageNumber: number, contentClass: P0AIndexedPage["contentClass"], text = ""): P0AIndexedPage {
  return {
    pageNumber, width: 595, height: 842, text, normalizedText: text.toLowerCase(),
    textHash: `${pageNumber}`.padStart(64, "a"), layoutHash: `${pageNumber}`.padStart(64, "b"),
    printedPageLabel: null, tokens: [], extractionStatus: text ? "NATIVE_TEXT" : "EMPTY",
    contentClass, sourceType: "NATIVE", sourceMetadata: null,
  };
}

function routed(page: P0AIndexedPage, pageClass: P0APageClass, statementType: P0AStatementType): P0ARoutedPage {
  return { ...page, pageClass, statementType, confidence: 1, matchedAnchors: [] };
}

test("OCR planner selects only contiguous image pages needed before a native primary corridor", () => {
  const index = [
    indexed(1, "NATIVE_TEXT", "cover narrative"), indexed(2, "IMAGE_ONLY"), indexed(3, "IMAGE_ONLY"),
    indexed(4, "IMAGE_ONLY"), indexed(5, "IMAGE_ONLY"), indexed(6, "NATIVE_TEXT", "statement of changes in equity"),
    indexed(7, "NATIVE_TEXT", "statement of changes in equity"), indexed(8, "NATIVE_TEXT", "statement of cash flows"),
    indexed(9, "NATIVE_TEXT", "statement of cash flows"),
  ];
  const pages = [
    routed(index[5], "PRIMARY_CHANGES_IN_EQUITY", "CHANGES_IN_EQUITY"),
    routed(index[6], "PRIMARY_CHANGES_IN_EQUITY", "CHANGES_IN_EQUITY"),
    routed(index[7], "PRIMARY_CASH_FLOW", "CASH_FLOW"), routed(index[8], "PRIMARY_CASH_FLOW", "CASH_FLOW"),
  ];
  assert.deepEqual(planOcrCompatibilityPages(index, pages, ["TOTAL_ASSETS_REPORTED", "REV_REPORTED"]).map((item) => item.pageNumber), [2, 3, 4, 5]);
});

test("OCR planner does nothing without unresolved primary requirements", () => {
  assert.deepEqual(planOcrCompatibilityPages([indexed(1, "IMAGE_ONLY")], [], []), []);
});

test("OCR planner does not OCR an image page when the unresolved statement type is already routed natively", () => {
  const image = indexed(1, "IMAGE_ONLY");
  const balance = indexed(2, "NATIVE_TEXT", "statement of financial position");
  assert.deepEqual(planOcrCompatibilityPages([image, balance], [routed(balance, "PRIMARY_BALANCE_SHEET", "BALANCE_SHEET")], ["TOTAL_ASSETS_REPORTED"]), []);
});

test("production OCR compatibility code contains no issuer/page/gold-value special case", () => {
  const source = readFileSync(join(process.cwd(), "lib/financial/p0a/ocr-compatibility.ts"), "utf8");
  assert.doesNotMatch(source, /DRMA|Dharma Polimetal|4[.,]705[.,]882[.,]300|pageNumber\s*===\s*(?:4|5|6|7)|pageNumber\s*==\s*(?:4|5|6|7)/i);
});
