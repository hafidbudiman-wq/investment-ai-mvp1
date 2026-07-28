# InvestAI Data Platform v1.0 — Architecture Review Pack

Status: **DESIGN ONLY — no production behavior changed**

This folder is the architecture gate before implementation of PDF Upload V2 and the broader InvestAI data platform.

## Golden rules

1. AI may read and propose; AI never silently changes canonical financial data.
2. Source documents, staging candidates, human decisions, validation, and canonical facts remain traceable.
3. Reported facts and derived facts are stored and presented separately.
4. File transfer, document processing, extraction, review, and canonical commit are separate state machines.
5. Large binary files do not live in PostgreSQL.
6. GET/read endpoints have no processing side effects.
7. Every background task is idempotent, lease-based, retry-bounded, and observable.
8. MVP 1.2B manual input and the committed ICBP golden dataset must remain unchanged during cutover.

## Documents

- [Platform Blueprint](./01-platform-blueprint.md)
- [Domain Model and ERD](./02-domain-model-erd.md)
- [Generic Job Engine](./03-job-engine.md)
- [Storage and Resumable Upload V2](./04-storage-upload-v2.md)
- [Metadata, Canonical Facts, and Revision Flow](./05-metadata-canonical-revision.md)
- [Delivery Plan, Feature Flags, and Acceptance Gates](./06-delivery-plan-and-gates.md)

## Important correction from the review

`FinancialReport` is **already present** in the current Prisma schema and correctly sits between `Company` and `FinancialEntry`. The platform does not need to invent that entity again. The required improvements are report revision/versioning, period basis, source-document linkage, and current-versus-superseded filing semantics.

## Decision status

| Decision | Status |
|---|---|
| Object storage instead of PostgreSQL BYTEA | Accepted |
| S3-compatible storage adapter | Accepted |
| Single PUT for small files, multipart for larger files | Accepted |
| Mobile multipart concurrency starts at 1, tested before increasing | Accepted |
| Generic durable job engine | Accepted |
| DB atomic claim + renewable lease | Accepted |
| Separate upload and extraction states | Accepted |
| Metadata confirmation is not a system failure | Accepted |
| Three implementation PRs behind feature flags | Accepted |
| Old upload path retained temporarily as rollback only | Accepted |
