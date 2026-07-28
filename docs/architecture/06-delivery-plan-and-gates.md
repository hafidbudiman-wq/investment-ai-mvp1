# 06 — Delivery Plan, Feature Flags, and Acceptance Gates

## Delivery strategy

No production cutover occurs from this design PR.

Implementation is split into three PRs:

### PR A — Foundation

- Prisma migrations for upload sessions, documents, jobs, attempts/events, metadata assertions, and revision support
- storage adapter interface
- Railway Bucket adapter
- configuration and feature flags
- side-effect-free read APIs
- no user-visible cutover

### PR B — Resumable Upload

- initiate/presign/complete/abort APIs
- single PUT for files up to 8 MB
- multipart above 8 MB, 5 MB parts
- mobile concurrency 1 default
- progress, retry, pause/resume
- magic-byte and size verification
- streamed SHA-256
- feature flag remains off by default

### PR C — Worker and Cutover

- separate Railway worker service
- atomic claim and lease heartbeat
- generic retry and manual retry UI
- OpenAI background submission/polling
- metadata confirmation state
- pipeline integration
- enable V2 for controlled users

## Feature flags

- `PDF_UPLOAD_V2`
- `PDF_UPLOAD_LEGACY`
- `GENERIC_JOB_WORKER`
- `METADATA_CONFIRMATION_V2`

Flags are server-controlled. Legacy remains a rollback option during the stability window but is not the default path.

## Legacy retirement

- Week 0: V2 internal test
- Week 1: V2 enabled for controlled production tests
- Week 2: V2 default, legacy hidden but available for rollback
- After 14 consecutive stable days and acceptance pass: remove BYTEA upload path in a separate PR

The schedule is a quality gate, not a promise to wait when critical issues remain.

## Acceptance matrix

### Transport

- small PDF through single PUT
- DRMA through Wi-Fi
- DRMA through 4G
- interrupt mid-part and resume
- refresh browser and resume on same device
- mobile concurrency 1 versus 2 measured empirically

### Durability

- redeploy web during upload
- redeploy worker during extraction
- expired lease reclaimed safely
- stale worker cannot finalize after losing lease
- retry stops at max attempts
- manual retry preserves attempt history

### Idempotency and cost

- upload same file twice
- simultaneous completion callbacks
- one checksum plus extraction version creates one active provider request
- duplicate document does not create duplicate canonical facts

### Validation and governance

- corrupt extension renamed to PDF fails magic-byte check
- company uncertainty becomes metadata review
- period uncertainty becomes metadata review
- ICBP remains 37 committed and 2 rejected
- MVP 1.2B manual input remains functional
- reported and derived data remain separate

## CI quality gate

Every implementation PR must pass:

- Prisma format and validation
- migration review and deploy test against a disposable PostgreSQL database
- Prisma client generation
- TypeScript type check
- Next.js production build
- unit tests for state transitions and claim logic
- integration tests for duplicate and retry behavior
- no secret or bucket credential exposed to the browser

## Confidence and open risks

Current architecture confidence: **94%**.

Residual risks:

1. Railway Bucket S3 compatibility details for multipart and CORS.
2. Actual DRMA size and mobile-network behavior.
3. Railway worker memory/CPU limits during provider transfer.
4. OpenAI background response retention and polling behavior.
5. Migration of current runtime-created async table without losing audit data.

Mitigation:

- adapter contract tests
- measured 4G acceptance test
- streamed I/O
- persisted provider IDs and idempotent polling
- explicit data migration and rollback script

Coding begins only after the design PR is reviewed and these risks are accepted or converted into spike tasks.
