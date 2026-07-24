# InvestAI — MVP 1.2C Excel Upload & Financial Data Import

## Goal
Import structured financial-statement Excel files without bypassing the canonical-data review gate.

## Flow
Excel (.xlsx/.xls) → parser → Account + Value extraction → Account Mapping lookup → mapped/unmapped preview → human review → confirm → PostgreSQL canonical database.

## Current PR acceptance scope
- Accept .xlsx/.xls up to 8 MB.
- Search the first 30 rows of each sheet for recognizable Account and Value headers.
- Extract numeric rows with source sheet and row number.
- Match reported account names against active AccountMapping records.
- Display mapped/unmapped preview.
- PREVIEW_ONLY: this PR intentionally does not persist imported values yet.

## Safety
Excel input never writes FinancialEntry automatically. Persistence must be implemented only after review, company/period/unit selection, duplicate detection, accounting validation, and transaction-safe save are completed.

## Next acceptance increment
1. Select Company, Period, Year and Unit before import.
2. Resolve unmapped accounts using Canonical Account Master.
3. Validate duplicates and statement consistency.
4. Save reviewed import in one Prisma transaction with SourceFile and AuditLog.
5. Re-read the saved report in Dashboard and Fundamental Analysis.
