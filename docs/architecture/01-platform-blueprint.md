# 01 — Platform Blueprint

## Purpose

InvestAI Data Platform converts source documents into traceable financial facts, derived metrics, dashboards, valuation inputs, and AI analysis without allowing AI to silently mutate canonical data.

## Logical layers

```text
User / Browser
  -> Application API
  -> Upload Service -> Object Storage
  -> Durable Job Engine -> Worker
  -> Document & Metadata Engine
  -> Structure-aware Extraction
  -> Staging Candidates
  -> Human Review + Validation
  -> Canonical Financial Facts
  -> Derived Metrics / Ratios / Trends
  -> Valuation / Knowledge / AI Assistant
```

## Runtime services

1. `investment-ai-web`
   - UI and read/write APIs.
   - Issues presigned upload instructions.
   - Never buffers large PDFs.
   - GET endpoints are side-effect free.

2. `investment-ai-worker`
   - Atomically claims jobs.
   - Streams documents from object storage.
   - Computes SHA-256 without loading the whole file into memory.
   - Calls extraction providers.
   - Renews leases and records stage/error telemetry.

3. PostgreSQL
   - Business metadata, report identities, upload sessions, jobs, staging candidates, review decisions, canonical facts, revisions, audit logs.
   - No large PDF BYTEA storage.

4. S3-compatible object storage
   - Original PDFs and optional generated artifacts.
   - Access only through a storage adapter.

## Bounded contexts

- Company Master
- Financial Reporting
- Document Ingestion
- Job Orchestration
- Metadata Resolution
- Extraction and Mapping
- Review and Validation
- Canonical Financial Facts
- Derived Analytics
- Knowledge and AI

## Key boundaries

- Upload completion does not mean extraction completion.
- Metadata uncertainty is not a technical failure.
- Extraction candidates are not canonical facts.
- Reported values are not derived values.
- A revised filing does not overwrite the prior filing.

## Existing schema preserved

The current schema already has the correct core chain:

```text
Company -> FinancialReport -> FinancialStatement / FinancialEntry
```

It also already contains staging entities:

```text
ExtractionRun -> ExtractionChunk -> ExtractionCandidate
```

The redesign extends these concepts rather than replacing them.

## Target confidence

- Domain model: 95%
- Canonical review flow: 98%
- Upload transport before implementation: 90%
- Generic job engine before implementation: 90%
- Overall architecture after design review: 94%

Remaining uncertainty is concentrated in Railway Bucket multipart API behavior, mobile network characteristics, and worker deployment/runtime limits. These are resolved by adapter isolation, feature flags, and acceptance testing rather than assumptions.
