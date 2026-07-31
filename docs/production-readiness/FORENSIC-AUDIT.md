# InvestAI production-readiness forensic audit

Audit baseline: `main` at `a93c05d` on 2026-07-31.

## Severity register

| Severity | Finding | Root cause | Impact | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| Critical | Empty-database migration is not reproducible | Migration history contains only the later data-platform tables; legacy financial and extraction tables exist only in `schema.prisma` | `prisma migrate deploy` cannot create a usable InvestAI database from empty PostgreSQL | Deploy every migration into disposable PostgreSQL and query all expected tables | Open |
| Critical | Health endpoint is static | `/api/health` does not query Prisma/PostgreSQL | Railway can report healthy while the application database is unavailable | Disconnect DB and require health to return 503; connect DB and require a successful probe | Open |
| Critical | Async extraction schema is created during requests | `AsyncExtractionJob` is absent from Prisma/migrations and created with raw DDL in application code | Runtime schema drift; restarts and deploys are not reproducible | Search runtime for DDL; deploy migrations into empty DB | Open |
| Critical | Canonical list of 13 critical investor accounts is absent | No source-code, config, test, documentation, seed, migration, historical branch, issue, or PR contains the promised list | The mandatory 100% critical-account gate cannot be calculated honestly | Repository-wide and GitHub metadata search | Blocked pending canonical definition |
| Critical | No cross-issuer golden tests | Existing tests cover storage/job primitives only | ICBP fixes can silently break DRMA/MEDC; period/unit/sign errors are undetected | Golden fixtures and regression suite for all three issuers | Open |
| High | Source document is not durably linked to the active legacy extraction flow | Upload bytes are temporarily stored in `AsyncExtractionJob.fileData`; `FinancialDocument` is not linked to `ExtractionRun` | Source evidence may be lost and cannot be audited after processing | Upload, restart, retrieve original checksum and evidence | Open |
| High | Structure-aware chunking is not locally enforced | AI is asked to return chunks; fallback code splits by blank lines/character count | Statement boundaries and table lineage depend on unvalidated model output | Unit tests for statement/page/table detection and chunk invariants | Open |
| High | OpenAI output receives only shallow validation | JSON is cast to TypeScript after checking only arrays | Invalid page, scale, currency, period, candidate, or canonical code may enter staging | Runtime schema validation and failure tests | Open |
| High | Review transitions do not write audit actions | Only final commit produces an `AuditLog` | Reviewer decisions are not fully attributable | Review API integration test and audit row assertion | Open |
| High | Production startup does not deploy migrations | Railway start is `npm run start` | A deploy may run application code against an older schema | Railway config and startup log evidence | Open |
| High | Build is not reproducible | No lockfile and Node version was not pinned | Dependency resolution and runtime differ across local, CI, and Railway | `npm ci`, pinned Node, production build | Fix in progress |
| Medium | Lint gate was missing | No lint script/config | Preventable defects were not blocked in CI | `npm run lint` | Fix in progress |
| Medium | `mock-data.ts` remains in production source tree | Legacy UI prototype file was retained | Future imports can accidentally reintroduce demo data | Remove file; code search in CI | Open |
| Medium | Several server pages convert DB errors to empty arrays | Broad `.catch(() => [])` | Database outages look like valid empty datasets | Error-state tests and structured logging | Open |
| Medium | Diagnostic UI is hard-coded to ICBP H1 2025 | Prototype diagnostic route/page | Cross-issuer diagnostic cannot be trusted as generic flow | Remove hard-coded default or require explicit query | Open |
| Low | README still instructs `prisma db push` for deployment | Early-MVP documentation | Operators may bypass controlled migration history | Documentation test/review | Open |

## Baseline evidence

- `npm ci`: failed because `package-lock.json` did not exist.
- `npm run lint`: script did not exist.
- `npx tsc --noEmit`: passed.
- Existing platform tests: 10 passed when invoked through `node --import tsx --test`; the `tsx` CLI itself cannot create an IPC socket in the Work Mode sandbox.
- `npm run build`: failed in the Work Mode Node 24 runtime with `uv_resident_set_memory`; repository CI was configured for Node 22 but the repository did not pin Railway/local Node.
- Attached sources were readable: ICBP, DRMA, MEDC H1 2025, MEDC FY 2025, and LSIP Q1 2026.
- The six supplied ICBP reference values were found in the source PDF text and retain negative parentheses for CAPEX.

## Audit rule

A finding is closed only by a repeatable command/test or runtime evidence. A build alone is not evidence of database, extraction, or financial correctness.
