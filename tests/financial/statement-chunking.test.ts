import assert from "node:assert/strict";
import test from "node:test";
import { createStructureAwareChunks, hasReliableNativeStatementStructure } from "../../lib/financial/statement-chunking";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { chunkNativePdf, extractNativePdfPages } from "../../lib/financial/pdf-native-text";

test("chunks bilingual statements by structure and joins continuation pages", () => {
  const chunks = createStructureAwareChunks([
    { pageNumber: 1, text: "PT Example\nLAPORAN POSISI KEUANGAN / STATEMENT OF FINANCIAL POSITION\nDalam jutaan Rupiah\nKas  1.000" },
    { pageNumber: 2, text: "Liabilitas  400\nEkuitas  600" },
    { pageNumber: 3, text: "LAPORAN LABA RUGI / STATEMENT OF PROFIT OR LOSS\nPendapatan  2.000\nLaba  200" },
    { pageNumber: 4, text: "LAPORAN ARUS KAS / STATEMENT OF CASH FLOWS\nKas dari operasi  300" },
  ]);

  assert.deepEqual(chunks.map((chunk) => chunk.statementType), ["BALANCE_SHEET", "INCOME_STATEMENT", "CASH_FLOW"]);
  assert.deepEqual([chunks[0].pageStart, chunks[0].pageEnd], [1, 2]);
  assert.equal(chunks[0].unitScale, 1_000_000);
  assert.equal(chunks[0].currency, "IDR");
  assert.match(chunks[0].checksum, /^[a-f0-9]{64}$/);
});

test("rejects duplicate page numbers", () => {
  assert.throws(() => createStructureAwareChunks([{ pageNumber: 1, text: "a" }, { pageNumber: 1, text: "b" }]), /unique positive/);
});

test("rejects giant OTHER native chunks as unreliable structure", () => {
  const chunks = createStructureAwareChunks([
    { pageNumber: 1, text: "Cover" },
    { pageNumber: 2, text: "Unreadable custom-font table" },
    { pageNumber: 333, text: "Notes" },
  ]);
  assert.equal(hasReliableNativeStatementStructure(chunks), false);
});

test("accepts native chunks after at least two primary statements are identified", () => {
  const chunks = createStructureAwareChunks([
    { pageNumber: 1, text: "STATEMENT OF FINANCIAL POSITION\nCash 100" },
    { pageNumber: 2, text: "STATEMENT OF PROFIT OR LOSS\nRevenue 200" },
  ]);
  assert.equal(hasReliableNativeStatementStructure(chunks), true);
});

test("extracts a valid PDF through PDF.js before structure-aware chunking", async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  page.drawText("LAPORAN POSISI KEUANGAN", { x: 50, y: 780, size: 14, font });
  page.drawText("Dalam jutaan Rupiah", { x: 50, y: 750, size: 11, font });
  page.drawText("Kas 1.000", { x: 50, y: 720, size: 11, font });
  const pdf = Buffer.from(await document.save({ useObjectStreams: false }));

  const pages = await extractNativePdfPages(pdf);
  assert.match(pages[0].text, /LAPORAN POSISI KEUANGAN/);
  const chunks = await chunkNativePdf(pdf);
  assert.equal(chunks[0].statementType, "BALANCE_SHEET");
  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks[0].unitScale, 1_000_000);
});
