import assert from "node:assert/strict";
import test from "node:test";
import { COMMIT_REQUIRED_ACCOUNT_CODES, CRITICAL_ACCOUNTS, CRITICAL_ACCOUNTS_STATUS } from "../../lib/financial/critical-accounts.config";

test("critical-account candidate set is centralized and internally complete", () => {
  assert.equal(CRITICAL_ACCOUNTS.length, 19);
  assert.equal(new Set(CRITICAL_ACCOUNTS.map((account) => account.code)).size, 19);
  for (const account of CRITICAL_ACCOUNTS) {
    assert.ok(account.nameId);
    assert.ok(account.nameEn);
    assert.ok(account.aliases.length > 0);
    assert.ok(account.validationRules.length > 0);
  }
  assert.deepEqual(
    ["TOTAL_ASSETS", "TOTAL_LIAB", "EQUITY", "EQUITY_PARENT", "SHARES_OUTSTANDING", "EPS_BASIC"].filter(
      (code) => !CRITICAL_ACCOUNTS.some((account) => account.code === code),
    ),
    [],
  );
  assert.equal(CRITICAL_ACCOUNTS_STATUS, "APPROVED_MVP1_CORE_19");
  assert.equal(COMMIT_REQUIRED_ACCOUNT_CODES.length, 18);
  assert.equal((COMMIT_REQUIRED_ACCOUNT_CODES as readonly string[]).includes("OPERATING_PROFIT"), false);
});
