import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const baselinePath = "prisma/migrations/20260731130000_legacy_financial_foundation/migration.sql";

test("migration history creates every legacy financial and extraction table", async () => {
  const sql = await readFile(baselinePath, "utf8");
  for (const table of [
    "Company", "FinancialReport", "FinancialStatement", "CanonicalAccount", "FinancialEntry",
    "AccountMapping", "DataWarning", "SourceFile", "AuditLog", "ExtractionRun",
    "ExtractionChunk", "ExtractionCandidate", "AsyncExtractionJob",
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));

  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS "(?:UploadSession|FinancialDocument|Job)"/);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
});

test("request-time extraction code contains no database DDL", async () => {
  const source = await readFile("lib/async-pdf-extraction.ts", "utf8");
  assert.doesNotMatch(source, /CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX/i);
  assert.doesNotMatch(source, /\$executeRawUnsafe|\$queryRawUnsafe/);
});

test("source-document and reviewed-fact migrations are additive", async () => {
  for (const path of [
    "prisma/migrations/20260731133000_source_document_lineage/migration.sql",
    "prisma/migrations/20260731140000_reviewed_fact_lineage/migration.sql",
  ]) {
    const sql = await readFile(path, "utf8");
    assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS/);
  }
});

test("canonical-quality migration is additive and preserves existing staging", async () => {
  const sql = await readFile("prisma/migrations/20260806173000_canonical_quality_engine/migration.sql", "utf8");
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "candidateRole"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "qualityStatus"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "CompanyAccountMapping"/);
  assert.match(sql, /CompanyAccountMapping_companyId_statementType_normalizedLabel_key/);
});
