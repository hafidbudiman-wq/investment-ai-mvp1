# 05 — Metadata, Canonical Facts, and Revision Flow

## Metadata engine

Metadata detection is a separate stage from financial extraction.

Fields resolved independently:

- company/ticker
- legal company name
- reporting year
- period type
- period start/end
- period basis
- currency
- unit scale
- consolidated versus parent-only
- audited versus unaudited
- original versus restated filing

Each assertion stores confidence and source evidence. Low confidence routes to `NEEDS_METADATA_CONFIRMATION`; it is not marked as a technical failure.

## Canonical commit rule

Only reviewed and validated staging candidates can create canonical reported facts.

Validation gates include:

- Assets = Liabilities + Equity
- cash-flow reconciliation where available
- currency/unit consistency
- period consistency
- duplicate account detection
- outlier and historical continuity warnings
- required source evidence

Warnings may block or allow commit depending on severity and governance policy.

## Revision flow

Committed facts are immutable in normal UI.

Correction creates a revision:

1. open current report revision
2. create draft revision
3. copy canonical facts as a baseline
4. change selected facts with reason and evidence
5. validate and review
6. publish revision
7. mark former revision superseded, never deleted

Revised OJK/company filings use the same mechanism but revision type is `SOURCE_REFILING`.

## Current-report selection

Dashboards use the latest published current revision by default. Users can inspect previous revisions and audit differences.

## Period semantics

- Balance sheet accounts: `POINT_IN_TIME`
- Interim income and cash-flow accounts: commonly `YTD`
- Standalone quarter values: derived unless explicitly reported

Examples:

```text
Q2 standalone revenue = H1 YTD revenue - Q1 revenue
Q4 standalone OCF = FY OCF - Q3 YTD OCF
```

Derived values are separately labeled and never overwrite reported source facts.

## Source lineage

Every canonical fact links back to:

```text
FinancialEntry
 -> accepted ExtractionCandidate
 -> ExtractionChunk
 -> FinancialDocument
 -> object storage key
 -> page / source text / extraction version
```

Manual facts retain their own actor, note, and source evidence.
