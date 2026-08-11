import assert from "node:assert/strict";
import test from "node:test";
import {
  createResumeToken,
  DATABASE_UPLOAD_PART_SIZE,
  expectedPartSize,
  hashResumeToken,
  partCount,
  validateResumableUploadMetadata,
  verifyResumeToken,
} from "../../lib/resumable-pdf-upload";

test("validates PDF metadata and a browser SHA-256 checksum", () => {
  const result = validateResumableUploadMetadata({
    fileName: "ICBP_bilingual_30Jun25.pdf",
    mimeType: "application/pdf",
    fileSize: DATABASE_UPLOAD_PART_SIZE + 17,
    checksum: "a".repeat(64),
  });
  assert.equal(result.fileName, "ICBP_bilingual_30Jun25.pdf");
  assert.equal(result.checksum, "a".repeat(64));
  assert.throws(() => validateResumableUploadMetadata({ ...result, checksum: "not-a-sha" }), /Checksum/);
});

test("plans one-megabyte resumable parts with an exact final part", () => {
  const size = DATABASE_UPLOAD_PART_SIZE * 2 + 317;
  assert.equal(partCount(size), 3);
  assert.equal(expectedPartSize(size, DATABASE_UPLOAD_PART_SIZE, 1), DATABASE_UPLOAD_PART_SIZE);
  assert.equal(expectedPartSize(size, DATABASE_UPLOAD_PART_SIZE, 2), DATABASE_UPLOAD_PART_SIZE);
  assert.equal(expectedPartSize(size, DATABASE_UPLOAD_PART_SIZE, 3), 317);
  assert.throws(() => expectedPartSize(size, DATABASE_UPLOAD_PART_SIZE, 4), /Nomor bagian/);
});

test("resume tokens are hashed and compared without storing the secret", () => {
  const token = createResumeToken();
  const hash = hashResumeToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(verifyResumeToken(token, hash), true);
  assert.equal(verifyResumeToken(`${token}x`, hash), false);
  assert.equal(verifyResumeToken(null, hash), false);
});
