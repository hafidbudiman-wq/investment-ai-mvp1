import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_UPLOAD_V2_POLICY,
  MIB,
  expectedPartSize,
  getUploadV2Policy,
  normalizeEtag,
  planUpload,
  sanitizeObjectFileName,
  validatePdfUploadMetadata,
} from "../../lib/platform/uploads/upload-v2-policy";

test("small PDFs use a single presigned PUT", () => {
  assert.deepEqual(planUpload(8 * MIB, DEFAULT_UPLOAD_V2_POLICY), {
    mode: "SINGLE_PUT",
    partSize: null,
    partCount: 1,
  });
});

test("larger PDFs use 5 MiB multipart chunks", () => {
  assert.deepEqual(planUpload(12 * MIB, DEFAULT_UPLOAD_V2_POLICY), {
    mode: "MULTIPART",
    partSize: 5 * MIB,
    partCount: 3,
  });
  assert.equal(
    expectedPartSize({ expectedSize: 12 * MIB, partSize: 5 * MIB, partNumber: 3 }),
    2 * MIB,
  );
});

test("rejects a PDF above the configured maximum", () => {
  assert.throws(
    () => validatePdfUploadMetadata(
      { fileName: "large.pdf", contentType: "application/pdf", size: 51 * MIB },
      DEFAULT_UPLOAD_V2_POLICY,
    ),
    /melebihi batas/,
  );
});

test("rejects invalid MIME or extension", () => {
  assert.throws(
    () => validatePdfUploadMetadata(
      { fileName: "report.exe", contentType: "application/pdf", size: MIB },
      DEFAULT_UPLOAD_V2_POLICY,
    ),
    /ekstensi/,
  );
  assert.throws(
    () => validatePdfUploadMetadata(
      { fileName: "report.pdf", contentType: "text/plain", size: MIB },
      DEFAULT_UPLOAD_V2_POLICY,
    ),
    /Tipe file/,
  );
});

test("policy rejects multipart chunks below the S3 minimum", () => {
  assert.throws(
    () => getUploadV2Policy({ PDF_UPLOAD_V2_PART_SIZE_BYTES: String(4 * MIB) } as NodeJS.ProcessEnv),
    /at least 5 MiB/,
  );
});

test("ETags and object filenames are normalized", () => {
  assert.equal(normalizeEtag('"abc123"'), "abc123");
  assert.equal(sanitizeObjectFileName("../../Laporan Keuangan Q2 (Final).PDF"), "Laporan-Keuangan-Q2-Final.pdf");
  assert.throws(() => normalizeEtag("bad\netag"), /ETag/);
});
