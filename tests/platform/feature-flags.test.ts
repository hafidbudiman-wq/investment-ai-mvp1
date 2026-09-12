import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeUploadFlagCombination,
  getPlatformFeatureFlags,
} from "../../lib/platform/feature-flags";

test("legacy upload remains enabled by default", () => {
  const previous = { ...process.env };
  delete process.env.PDF_UPLOAD_V2;
  delete process.env.PDF_UPLOAD_LEGACY;
  delete process.env.GENERIC_JOB_WORKER;
  delete process.env.INVESTAI_P0A_SHADOW;
  delete process.env.INVESTAI_EXTRACTION_QA;
  try {
    assert.deepEqual(getPlatformFeatureFlags(), {
      pdfUploadV2: false,
      pdfUploadLegacy: true,
      genericJobWorker: false,
      metadataConfirmationV2: false,
      investaiP0AShadow: false,
      investaiExtractionQa: false,
    });
  } finally {
    process.env = previous;
  }
});

test("rejects disabling both upload paths", () => {
  assert.throws(
    () =>
      assertSafeUploadFlagCombination({
        pdfUploadV2: false,
        pdfUploadLegacy: false,
        genericJobWorker: false,
        metadataConfirmationV2: false,
        investaiP0AShadow: false,
        investaiExtractionQa: false,
      }),
    /At least one PDF upload path/,
  );
});

test("rejects V2 without the durable worker", () => {
  assert.throws(
    () =>
      assertSafeUploadFlagCombination({
        pdfUploadV2: true,
        pdfUploadLegacy: true,
        genericJobWorker: false,
        metadataConfirmationV2: false,
        investaiP0AShadow: false,
        investaiExtractionQa: false,
      }),
    /requires GENERIC_JOB_WORKER/,
  );
});

test("rejects P0-A shadow without the durable worker", () => {
  assert.throws(
    () => assertSafeUploadFlagCombination({
      pdfUploadV2: false,
      pdfUploadLegacy: true,
      genericJobWorker: false,
      metadataConfirmationV2: false,
      investaiP0AShadow: true,
      investaiExtractionQa: false,
    }),
    /requires GENERIC_JOB_WORKER/,
  );
});
