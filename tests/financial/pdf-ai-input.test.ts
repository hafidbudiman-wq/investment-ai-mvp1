import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { AI_PDF_MAX_PAGES, preparePdfAiInput } from "../../lib/financial/pdf-ai-input";

async function pdfWithPages(count: number) {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) document.addPage([595, 842]);
  return Buffer.from(await document.save());
}

test("keeps ordinary reports intact", async () => {
  const input = await pdfWithPages(12);
  const prepared = await preparePdfAiInput(input);
  assert.equal(prepared.reduced, false);
  assert.equal(prepared.originalPageCount, 12);
  assert.deepEqual(prepared.bytes, input);
});

test("bounds very long reports before provider submission", async () => {
  const input = await pdfWithPages(AI_PDF_MAX_PAGES + 15);
  const prepared = await preparePdfAiInput(input);
  assert.equal(prepared.reduced, true);
  assert.equal(prepared.originalPageCount, AI_PDF_MAX_PAGES + 15);
  const bounded = await PDFDocument.load(prepared.bytes);
  assert.equal(bounded.getPageCount(), AI_PDF_MAX_PAGES);
});
