import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260728154000_data_platform_foundation/migration.sql";

test("data platform migration remains additive to legacy financial tables", async () => {
  const sql = await readFile(MIGRATION_PATH, "utf8");
  const normalized = sql.replace(/--.*$/gm, "").toUpperCase();

  for (const forbidden of [
    /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)\b/,
    /\bTRUNCATE\b/,
    /\bDELETE\s+FROM\b/,
    /\bUPDATE\s+"?(COMPANY|FINANCIALREPORT|FINANCIALENTRY|EXTRACTIONRUN)"?\b/,
    /\bALTER\s+TABLE\s+"?(COMPANY|FINANCIALREPORT|FINANCIALENTRY|EXTRACTIONRUN)"?\b/,
  ]) {
    assert.equal(
      forbidden.test(normalized),
      false,
      `Migration contains a forbidden destructive statement: ${forbidden}`,
    );
  }

  for (const requiredTable of [
    "UploadSession",
    "UploadPart",
    "FinancialDocument",
    "Job",
    "JobAttempt",
    "JobEvent",
    "MetadataAssertion",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${requiredTable}"`));
  }

  assert.match(sql, /CREATE INDEX "Job_correlationId_idx"/);
  assert.doesNotMatch(sql, /CREATE UNIQUE INDEX "Job_correlationId/);
  assert.match(sql, /CREATE UNIQUE INDEX "Job_active_deduplicationKey_key"/);
});
