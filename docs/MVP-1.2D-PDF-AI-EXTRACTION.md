# MVP 1.2D — PDF + AI Financial Extraction

## Goal
Turn a financial-statement PDF into traceable extraction candidates without allowing AI to silently mutate the canonical financial database.

## Golden rule
AI may read, classify, map, and propose. Only an explicit reviewed commit path may write canonical `FinancialEntry` values.

## Pipeline
1. Upload PDF and compute SHA-256 checksum.
2. Pre-process document metadata and detect extraction strategy.
3. Split document into structure-aware chunks (section/table/page/token fallback).
4. Extract candidate financial facts into staging.
5. Map reported labels to `CanonicalAccount` with a separate mapping confidence.
6. Preserve source evidence: page, chunk, reported label, raw text, and extraction confidence.
7. Review candidates. Low-confidence/unmapped candidates remain pending.
8. Validate accounting/period/unit/currency/duplicate rules.
9. Explicitly commit accepted candidates to the existing canonical database in a transaction.
10. Write audit logs for review and commit actions.

## Safety requirements
- No automatic writes from AI extraction to `FinancialEntry`.
- Duplicate PDF checksum must be detectable.
- Re-running the same extraction must be idempotent at run/result level.
- Existing MVP 1.2B manual save API remains unchanged.
- New database changes must be additive; no destructive column conversion/drop.
- Railway build remains `npm run build`; schema deployment is reviewed separately.

## MVP 1.2D acceptance gates
- Prisma schema validates.
- Next.js production build passes.
- PDF-only validation and upload size limit exist.
- Extraction staging stores source evidence and two confidence dimensions.
- UI clearly labels data as staged/not yet canonical.
- No staging endpoint can directly create/update `FinancialEntry`.
- Commit endpoint requires explicit accepted/reviewed candidates and runs canonical validations.
- Existing manual financial input continues to work unchanged.

## Scope note
OCR for scanned PDFs and vector/RAG retrieval are extension points. Structure-aware chunking is part of 1.2D; a vector database is not required for the first safe extraction increment.
