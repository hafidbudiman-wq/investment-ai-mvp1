import assert from "node:assert/strict";
import test from "node:test";
import { FINANCIAL_EXTRACTION_MAX_OUTPUT_TOKENS } from "../../lib/openai-financial-extraction";

test("financial extraction reserves a bounded structured-output budget", () => {
  assert.ok(FINANCIAL_EXTRACTION_MAX_OUTPUT_TOKENS >= 3_500);
  assert.ok(FINANCIAL_EXTRACTION_MAX_OUTPUT_TOKENS <= 8_000);
});
