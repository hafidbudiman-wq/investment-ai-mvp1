# Railway Deployment Runbook — PDF Upload V2

Status: infrastructure preparation only. Keep V2 disabled until acceptance gates pass.

## Services

1. Existing web service: `investment-ai-web`
2. New worker service: `investment-ai-worker`
3. PostgreSQL service
4. Private Railway Storage Bucket

## Required server variables

Set on both web and worker unless noted:

```text
DATABASE_URL=<existing Railway PostgreSQL URL>
STORAGE_PROVIDER=RAILWAY
S3_ENDPOINT=<bucket S3 endpoint>
S3_REGION=<bucket region or auto>
S3_BUCKET_NAME=<bucket name>
S3_ACCESS_KEY=<secret>
S3_SECRET_KEY=<secret>
S3_FORCE_PATH_STYLE=true
S3_PRESIGN_EXPIRES_SECONDS=900
PDF_UPLOAD_V2=false
PDF_UPLOAD_LEGACY=true
GENERIC_JOB_WORKER=false
METADATA_CONFIRMATION_V2=false
```

Never expose access keys through `NEXT_PUBLIC_*` variables.

## Bucket CORS

Allow only explicit application origins. Do not use wildcard origins with credentials.

Example policy, adjusted to the exact Railway production and staging domains:

```json
[
  {
    "AllowedOrigins": [
      "https://investment-ai-mvp1-production.up.railway.app",
      "https://<staging-domain>"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ETag` must be exposed because the browser records each completed multipart part.

## Worker service

The worker uses the same repository and database but a different start command. The final command is introduced in PR C after the worker loop exists.

Expected shape:

```text
npm install --no-audit --no-fund
npm run db:deploy
npm run worker
```

Keep `GENERIC_JOB_WORKER=false` until the worker image boots, health checks pass, and no job is consumed unintentionally.

## Safe activation sequence

1. Merge PR A with all feature flags defaulting off except legacy.
2. Provision bucket and worker service.
3. Add variables and CORS.
4. Verify bucket adapter using a non-financial test PDF without OpenAI calls.
5. Deploy PR B upload APIs/UI with `PDF_UPLOAD_V2=false`.
6. Run Wi-Fi, 4G, interruption, refresh, and resume tests.
7. Deploy PR C worker with `GENERIC_JOB_WORKER=false`.
8. Enable worker for controlled test documents.
9. Enable V2 for controlled users while legacy remains available.
10. Make V2 default only after the complete acceptance matrix passes.

## Rollback

```text
PDF_UPLOAD_V2=false
PDF_UPLOAD_LEGACY=true
GENERIC_JOB_WORKER=false
```

Disabling flags must not delete uploaded objects, jobs, attempts, staging candidates, or audit history.

## Production evidence required

- bucket HEAD succeeds from server
- browser preflight succeeds from production domain
- single PUT succeeds
- multipart completion returns correct size
- `%PDF-` magic-byte verification succeeds
- SHA-256 is streamed, not buffered
- duplicate upload does not trigger duplicate extraction
- worker restart safely reclaims the job
- stale worker cannot finalize after lease loss
- DRMA reaches metadata/review state through 4G
- ICBP golden dataset remains unchanged
