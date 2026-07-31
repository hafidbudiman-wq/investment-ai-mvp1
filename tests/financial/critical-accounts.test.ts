import assert from "node:assert/strict";
import test from "node:test";
import { CRITICAL_ACCOUNTS, CRITICAL_ACCOUNTS_STATUS } from "../../lib/financial/critical-accounts.config";

test("critical-account candidate set is centralized and internally complete", () => {
  assert.equal(CRITICAL_ACCOUNTS.length, 13);
  assert.equal(new Set(CRITICAL_ACCOUNTS.map((account) => account.code)).size, 13);
  for (const account of CRITICAL_ACCOUNTS) {
    assert.ok(account.nameId);
    assert.ok(account.nameEn);
    assert.ok(account.aliases.length > 0);
    assert.ok(account.validationRules.length > 0);
  }
  assert.equal(CRITICAL_ACCOUNTS_STATUS, "PROVISIONAL_REQUIRES_PRODUCT_OWNER_CONFIRMATION");
});
