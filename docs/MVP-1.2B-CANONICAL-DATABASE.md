# Investment AI — MVP 1.2B Canonical Financial Database

## Goal
MVP 1.2B turns the working PostgreSQL foundation into a canonical, auditable financial data layer that can support historical statements, PDF/Excel extraction, fundamental analysis, growth, valuation, and the future AI Investment Analyst.

## Data flow

`Company -> FinancialReport -> FinancialStatement -> FinancialEntry -> CanonicalAccount`

Supporting tables:

- `AccountMapping`: maps labels from PDF/Excel/AI to canonical accounts.
- `DataWarning`: validation and data-quality findings.
- `SourceFile`: provenance for PDF, Excel, API, or other source files.
- `AuditLog`: trace of saves, approvals, edits, and future AI extraction actions.

## Core design rules

1. Raw/report-specific labels never become the analytical standard. They map to `CanonicalAccount`.
2. Every numeric value belongs to a company + reporting period + canonical account.
3. Income statement, balance sheet, and cash-flow values are separated through `FinancialStatement`.
4. Existing MVP 1.2A manual-input behavior is preserved.
5. Existing data is preserved by additive Prisma changes; no destructive migration is required for this step.
6. AI-extracted values must be reviewed/validated before being considered verified canonical data.

## Canonical account master

The seed includes the initial high-value accounts needed for the next phases: revenue, COGS, gross profit, EBIT, EBITDA, net profit, EPS, cash, receivables, inventory, PPE, goodwill, debt, liabilities, equity, OCF, capex, investing/financing cash flow, and FCF.

This is deliberately a foundation set rather than a fake 200-account list. The account master should be expanded using real Indonesian issuer statements during MVP 1.2C/1.2D so each additional account has a clear analytical purpose and mapping rule.

## Railway deployment

The existing Railway pre-deploy command can remain:

`npx prisma db push && npx prisma db seed`

After this branch is merged into `main`, Railway will apply the additive schema to the connected PostgreSQL database and reseed the canonical account master.

## Acceptance tests

1. Railway build and pre-deploy complete successfully.
2. Existing companies remain visible.
3. Existing manual financial reports remain visible.
4. Saving a new manual report still works.
5. A valid balance sheet becomes `VERIFIED`.
6. An invalid balance sheet creates a `DataWarning` and becomes `PENDING_REVIEW`.
7. New saves create `FinancialStatement` records and an `AuditLog` record.
8. Dashboard report/warning counts remain correct.

## Next milestone

MVP 1.2C: Excel ingestion -> raw labels -> AccountMapping -> review -> canonical save.
