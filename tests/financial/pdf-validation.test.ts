import assert from "node:assert/strict";
import test from "node:test";
import { inspectPdfForOcr, validatePdfMagic, validatePdfUpload } from "../../lib/pdf-extraction";

const file = (overrides: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: "report.pdf",
  type: "application/pdf",
  size: 100,
  arrayBuffer: async () => new ArrayBuffer(0),
  ...overrides,
});

test("validates upload metadata and PDF magic bytes", () => {
  assert.doesNotThrow(() => validatePdfUpload(file()));
  assert.doesNotThrow(() => validatePdfMagic(Buffer.from("%PDF-1.7\n")));
  assert.throws(() => validatePdfUpload(file({ name: "report.txt", type: "text/plain" })), /PDF/);
  assert.throws(() => validatePdfUpload(file({ size: 0 })), /kosong/);
  assert.throws(() => validatePdfMagic(Buffer.from("not a pdf")), /bukan dokumen PDF/);
});

test("routes image-only and native PDFs through different preflight modes", () => {
  assert.equal(inspectPdfForOcr(Buffer.from("%PDF-1.7 /Subtype /Image /Subtype /Image")).processingMode, "VISION_OCR_FALLBACK");
  assert.equal(inspectPdfForOcr(Buffer.from("%PDF-1.7 BT ET Tj /Font /Font")).processingMode, "NATIVE_TEXT");
});
