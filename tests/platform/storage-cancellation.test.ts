import assert from "node:assert/strict";
import test from "node:test";
import { S3DocumentStorage } from "../../lib/platform/storage/s3-document-storage";

const storage = new S3DocumentStorage({
  provider: "S3",
  endpoint: "https://storage.example.com",
  region: "auto",
  bucket: "investai-test",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  forcePathStyle: true,
  presignExpiresSeconds: 900,
});

test("single upload presigning honors an already aborted signal", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));

  await assert.rejects(() =>
    storage.createSingleUpload(
      {
        objectKey: "documents/test.pdf",
        contentType: "application/pdf",
        contentLength: 1024,
        expiresInSeconds: 900,
      },
      { signal: controller.signal },
    ),
  );
});

test("multipart part presigning honors an already aborted signal", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));

  await assert.rejects(() =>
    storage.presignMultipartPart(
      {
        objectKey: "documents/test.pdf",
        providerUploadId: "upload-id",
        partNumber: 1,
        expiresInSeconds: 900,
      },
      { signal: controller.signal },
    ),
  );
});
