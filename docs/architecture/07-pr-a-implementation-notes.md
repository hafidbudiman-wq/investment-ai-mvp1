# PR A — Foundation Implementation Notes

Status: **DRAFT IMPLEMENTATION — DO NOT MERGE YET**

## Included so far

- server-controlled feature flags with a safe fallback rule
- provider-neutral `DocumentStorage` interface
- generic job types and default lease/retry policy
- additive PostgreSQL migration for upload sessions, financial documents, jobs, attempts, events, and metadata assertions

## Intentionally not enabled

- no V2 upload endpoint
- no direct bucket upload
- no worker process
- no production route cutover
- no deletion of legacy BYTEA path
- no change to ICBP canonical facts

## Remaining before PR A can leave draft

1. Add the new models to `prisma/schema.prisma` so Prisma Client and migration remain aligned.
2. Add a Railway S3-compatible adapter behind the `DocumentStorage` contract.
3. Add configuration validation without exposing bucket secrets to the browser.
4. Add repository functions for atomic job claim, heartbeat, completion, and retry scheduling.
5. Add side-effect-free V2 read APIs while leaving the legacy route operational behind its flag.
6. Add CI checks for Prisma validate/generate, TypeScript, build, and migration smoke test.
7. Add tests for feature-flag safety and job state transitions.

## Migration safety

The migration is additive only. It does not alter current `FinancialReport`, `FinancialEntry`, `ExtractionRun`, or legacy async extraction data. The active-deduplication guarantee is implemented with a PostgreSQL partial unique index because Prisma cannot express this rule directly in the schema.

## Merge gate

PR A must not merge until:

- Prisma schema and SQL migration are reviewed together
- migration applies cleanly to a disposable PostgreSQL database
- current MVP 1.2B build passes
- current ICBP 37 committed / 2 rejected behavior is unchanged
- all V2 flags default to off, while legacy remains on
