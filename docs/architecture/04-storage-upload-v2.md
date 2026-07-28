# 04 — Storage and Resumable Upload V2

## Storage abstraction

Application code depends on a `DocumentStorage` interface, not Railway-specific APIs.

Required methods:

- initiate single upload
- initiate multipart upload
- presign part
- complete multipart
- abort multipart
- head object
- open read stream
- delete object

Railway Bucket is the first adapter. S3 and Cloudflare R2 remain replaceable adapters.

## Upload policy

Initial configurable defaults:

- maximum file size: 25 MB
- single PUT threshold: up to 8 MB
- multipart threshold: above 8 MB
- multipart part size: 5 MB, except final part
- mobile concurrency: 1 by default
- desktop concurrency: 2 by default
- per-part retries: 3
- backoff: 1s, 3s, 8s plus jitter
- upload session expiry: 24 hours

The thresholds are configuration, not hard-coded business rules. Mobile concurrency 2 is tested but not assumed better.

## Validation layers

1. Client validates extension, MIME, and declared size before initiating.
2. Initiate API validates metadata and authorization.
3. Complete API performs HEAD verification for actual size.
4. Verification worker streams the first bytes and confirms `%PDF-` magic bytes.
5. Full SHA-256 is computed through streaming from object storage.

`Content-Length` is used when present but is not the sole security control.

## Resume behavior

The client stores upload session ID, resume token, object key reference, completed parts, and ETags in browser storage. Refreshing the page can resume from the last confirmed part on the same device.

The UI displays:

- preparing
- uploading part n/N
- bytes and percentage
- retrying part
- paused / resume available
- verifying
- queued for AI

## Duplicate behavior

Before upload, filename plus size provides a warning only. It never proves identity.

After upload, streamed SHA-256 is the source of truth. A duplicate document is linked to the existing processing result where safe, and no second OpenAI request is created.

## Cleanup

A cleanup job runs every 6 hours:

- multipart sessions older than 24 hours: abort
- unreferenced uploaded objects older than 48 hours: delete after safety check
- temporary failed documents: retain 7 days for diagnosis unless marked corrupt/sensitive

Cleanup actions are audited and idempotent.

## Legacy path

The current multipart-to-Next.js/BYTEA path remains available only behind `PDF_UPLOAD_LEGACY=true` during controlled rollout. It is not shown as the normal UI path after V2 activation and is removed after the stability window.
