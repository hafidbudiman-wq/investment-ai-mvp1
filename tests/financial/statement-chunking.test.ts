import assert from "node:assert/strict";
import test from "node:test";
import { createStructureAwareChunks } from "../../lib/financial/statement-chunking";
import { deflateSync } from "node:zlib";
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

test("extracts real PDF content streams before structure-aware chunking", () => {
  const stream = deflateSync(Buffer.from("BT (LAPORAN POSISI KEUANGAN) Tj (Dalam jutaan Rupiah) Tj [(Kas) 120 (  1.000)] TJ ET"));
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n4 0 obj << /Length "),
    Buffer.from(String(stream.length)),
    Buffer.from(" /Filter /FlateDecode >> stream\n"), stream,
    Buffer.from("\nendstream\nendobj\n%%EOF"),
  ]);
  const pages = extractNativePdfPages(pdf);
  assert.match(pages[0].text, /LAPORAN POSISI KEUANGAN/);
  const chunks = chunkNativePdf(pdf);
  assert.equal(chunks[0].statementType, "BALANCE_SHEET");
  assert.equal(chunks[0].pageStart, 1);
  assert.equal(chunks[0].unitScale, 1_000_000);
});
