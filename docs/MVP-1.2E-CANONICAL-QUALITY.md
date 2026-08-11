# MVP 1.2E — Deterministic Canonical Quality

## Objective

Convert staging candidates into trustworthy canonical facts without asking the investor to choose accounting mappings row by row and without repeating OpenAI extraction.

## Decision model

- `GREEN`: source page/text, statement type, period unit, mapping, and reconciliation passed. A final fact is automatically `ACCEPTED`.
- `YELLOW`: evidence or mapping is ambiguous. The candidate remains `PENDING` and Save is blocked.
- `RED`: contradictory or invalid evidence. The candidate remains `PENDING` and must be repaired or reprocessed.
- `COMPONENT` / `DUPLICATE`: preserved in staging for audit but automatically `REJECTED`; it never creates another canonical value.

Only one GREEN final candidate may exist for each canonical code.

## Deterministic controls

1. COGS is stored as a positive analytical expense.
2. CAPEX is stored as a negative cash outflow.
3. `GROSS_PROFIT = REV - COGS` must reconcile in the same currency and unit.
4. `TOTAL_ASSETS = TOTAL_LIAB + EQUITY` must reconcile in the same currency and unit.
5. Shares outstanding must be a positive full-share integer, exclude treasury shares, use currency `SHARES`, and use scale `1`.
6. Basic EPS must be the reported full per-share amount with scale `1`.
7. `FCF = OCF + negative CAPEX` must reconcile in the same currency and unit.
8. Total debt sums current and non-current bank/non-bank borrowings, bonds, and lease liabilities.
9. AR and AP counterparty components must reconcile to their selected totals when the components are present.
10. Productive-asset CAPEX includes PPE, oil-and-gas properties, exploration/evaluation, concessions, and identifiable intangibles. Generic “other assets” are excluded unless their productive long-lived nature is proven.
11. Missing metrics are reported as “not safely reported”; the engine never invents an operating-profit subtotal.

## Approved MVP1 core facts

The quality gate covers 19 facts. The six additions to the original set are `TOTAL_ASSETS`, `TOTAL_LIAB`, `EQUITY`, `EQUITY_PARENT`, `SHARES_OUTSTANDING`, and `EPS_BASIC`.

Save requires 18 GREEN facts. `OPERATING_PROFIT` is the only permitted omission because some issuers do not present a unique operating subtotal; the engine must not invent one. A run with any other missing critical fact remains `PENDING_REVIEW`.

## Mapping memory and API budget

After Save, direct final labels are stored in `CompanyAccountMapping` at the grain:

`company + statement type + normalized reported label`

The next report for the same issuer reuses approved mappings deterministically. Components, derived values, and duplicates are not learned as direct mappings. Reclassification of existing staging is performed by the Worker and makes no OpenAI request.

## Golden regression

The versioned test set covers:

- ICBP H1 2025
- ICBP H1 2026 live-staging regression
- DRMA FY 2025
- MEDC H1 2025
- MEDC FY 2025
- LSIP Q1 2026

Every fixture checks canonical fact count, missing-fact count, evidence-only count, zero expected exceptions, duplicate suppression, and accounting equations. ICBP H1 2025 and DRMA FY 2025 cover all 19 facts. MEDC H1 2025 covers 18 because operating profit is not safely reported as a direct subtotal. Older staging fixtures remain partial by design and prove that missing facts are reported rather than invented.
