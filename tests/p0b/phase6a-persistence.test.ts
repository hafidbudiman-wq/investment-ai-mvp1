import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("prisma/migrations/20260914120000_phase6a_p0b_core/migration.sql", "utf8");
const persistence = readFileSync("lib/financial/p0b/persistence.ts", "utf8");
const compatibilityRead = readFileSync("lib/financial/p0b/compatibility-read.ts", "utf8");

test("Phase 6A migration is additive, versioned and legacy-safe", () => {
  for (const table of ["P0BExtractionRun", "P0BRequirementOutcome", "DerivedMetricDefinition", "DerivedMetricResult", "DerivedMetricInput"]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|UPDATE|DELETE\s+FROM)\b/im);
  assert.doesNotMatch(migration, /ALTER\s+TABLE\s+"(?:FinancialEntry|CanonicalAccount|P0AFactAssertion|P0AFactEvidence)"/i);
  assert.match(migration, /P0BRequirementOutcome_family_target_check/);
  assert.match(migration, /DerivedMetricDefinition_code_formulaVersion_key/);
  assert.match(migration, /DerivedMetricResult_resultHash_key/);
});

test("Phase 6A persistence uses immutable identities and never writes legacy facts", () => {
  assert.match(persistence, /completeIdentityHash:\s*input\.result\.runIdentity/);
  assert.match(persistence, /where:\s*\{\s*resultHash:\s*outcome\.formula\.resultHash/);
  assert.match(persistence, /inputIdentity:\s*metricInput\.inputId/);
  assert.match(persistence, /inputEvidenceHashes:/);
  assert.match(persistence, /Unpersisted exact input identity/);
  assert.doesNotMatch(persistence, /(?:financialEntry|canonicalAccount)\.(?:create|update|upsert|delete)/i);
});

test("Phase 6A compatibility read keeps reported and calculated lineage separate", () => {
  assert.match(compatibilityRead, /reportedLineage:/);
  assert.match(compatibilityRead, /calculatedLineage:/);
  assert.match(compatibilityRead, /inputAssertionId:/);
  assert.match(compatibilityRead, /inputResultId:/);
  assert.doesNotMatch(compatibilityRead, /financialEntry\.(?:create|update|upsert|delete)/i);
});
