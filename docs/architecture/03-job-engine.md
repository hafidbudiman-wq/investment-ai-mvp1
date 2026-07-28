# 03 — Generic Durable Job Engine

## Scope

One generic queue supports PDF extraction now and later ratio calculation, valuation, knowledge graph indexing, RAG indexing, and AI summaries.

## Job states

```text
QUEUED -> CLAIMED -> RUNNING -> SUCCEEDED
                    -> RETRY_WAIT -> QUEUED
                    -> NEEDS_INPUT
                    -> FAILED
                    -> CANCELLED
```

## Atomic claim

Workers claim jobs in PostgreSQL using `FOR UPDATE SKIP LOCKED` or atomic `UPDATE ... RETURNING`. In-memory locks are forbidden.

## Lease policy

Initial defaults:

- lease duration: 120 seconds
- heartbeat: every 30 seconds
- reclaim eligibility: lease expired for 30 seconds
- default max attempts: 3
- extraction-specific max attempts: 3
- transient retry backoff: 30 seconds, 2 minutes, 10 minutes

A worker renews the lease while working. Finalization updates must include the current lease owner/claim token so an expired worker cannot overwrite a newer attempt.

## Idempotency and billing protection

- `deduplicationKey` is unique for active jobs.
- OpenAI submission stores provider response ID before continuing.
- Reclaimed jobs first check whether a provider response already exists.
- Final staging writes use unique constraints and transactions.
- One document checksum plus extraction version creates at most one active extraction job.

## Attempts and dead-letter behavior

After max attempts, status becomes `FAILED`. The job remains visible with error code, stage, and attempt history.

Manual retry is available in UI and creates a new attempt only after explicit confirmation. It does not erase history. Retry eligibility depends on error class:

- transient provider/network error: retry allowed
- corrupt/non-PDF document: retry blocked until a new document is uploaded
- metadata uncertainty: route to `NEEDS_INPUT`, not `FAILED`
- unsupported document: retry blocked unless extraction version changes

## Job types

Initial:

- `DOCUMENT_VERIFY`
- `FINANCIAL_METADATA_DETECT`
- `FINANCIAL_EXTRACT`
- `OPENAI_RESPONSE_POLL`
- `ABANDONED_UPLOAD_CLEANUP`

Future:

- `DERIVED_METRIC_CALCULATE`
- `VALUATION_CALCULATE`
- `RAG_INDEX`
- `KNOWLEDGE_GRAPH_SYNC`
- `AI_THESIS_GENERATE`

## Observability

Each job records correlation ID, stage, worker ID, claim token, attempt, duration, provider request/response IDs, error code, and sanitized error message. A `JobEvent` table stores state transitions.
