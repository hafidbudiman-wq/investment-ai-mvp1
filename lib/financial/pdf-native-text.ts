import { inflateSync } from "node:zlib";
import { createStructureAwareChunks, type ExtractedPage, type StructureAwareChunk } from "@/lib/financial/statement-chunking";

function unescapePdfString(value: string): string {
  return value.replace(/\\([0-7]{1,3}|n|r|t|b|f|[()\\])/g, (_match, escape: string) => {
    if (/^[0-7]+$/.test(escape)) return String.fromCharCode(Number.parseInt(escape, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[escape] ?? escape;
  });
}

function textFromContentStream(stream: Buffer): string {
  const source = stream.toString("latin1");
  const lines: string[] = [];
  const operator = /(\((?:\\.|[^\\)])*\)|<([0-9a-fA-F\s]+)>|\[((?:\((?:\\.|[^\\)])*\)|<[^>]*>|[^\]])*)\])\s*(Tj|'|"|TJ)/g;
  for (const match of source.matchAll(operator)) {
    const strings: string[] = [];
    for (const token of match[1].matchAll(/\((?:\\.|[^\\)])*\)|<([0-9a-fA-F\s]+)>/g)) {
      if (token[0].startsWith("(")) strings.push(unescapePdfString(token[0].slice(1, -1)));
      else strings.push(Buffer.from((token[1] ?? "").replace(/\s/g, ""), "hex").toString("latin1"));
    }
    if (strings.length) lines.push(strings.join(""));
  }
  return lines.join("\n").replace(/\u0000/g, "").trim();
}

/** Extracts the native text layer page-by-page without treating the PDF binary as plain text. */
export function extractNativePdfPages(bytes: Buffer): ExtractedPage[] {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Invalid PDF header.");
  const binary = bytes.toString("latin1");
  const objects = new Map<number, { dictionary: string; stream?: Buffer }>();
  const objectPattern = /(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g;
  for (const match of binary.matchAll(objectPattern)) {
    const body = match[2];
    const streamMatch = body.match(/([\s\S]*?)stream\r?\n([\s\S]*?)\r?\nendstream/);
    let stream: Buffer | undefined;
    if (streamMatch) {
      const encoded = Buffer.from(streamMatch[2], "latin1");
      stream = /\/FlateDecode\b/.test(streamMatch[1]) ? inflateSync(encoded) : encoded;
    }
    objects.set(Number(match[1]), { dictionary: streamMatch?.[1] ?? body, stream });
  }

  const pages: ExtractedPage[] = [];
  for (const object of objects.values()) {
    if (!/\/Type\s*\/Page\b/.test(object.dictionary)) continue;
    const contents = object.dictionary.match(/\/Contents\s*(?:\[([^\]]+)\]|(\d+)\s+\d+\s+R)/);
    const references = [...(contents?.[1] ?? contents?.[2] ?? "").matchAll(/(\d+)(?:\s+\d+\s+R)?/g)].map((item) => Number(item[1]));
    const text = references.map((reference) => objects.get(reference)?.stream).filter((value): value is Buffer => Boolean(value)).map(textFromContentStream).filter(Boolean).join("\n");
    pages.push({ pageNumber: pages.length + 1, text });
  }
  if (!pages.length) throw new Error("PDF does not contain a readable page tree.");
  return pages;
}

export function chunkNativePdf(bytes: Buffer): StructureAwareChunk[] {
  return createStructureAwareChunks(extractNativePdfPages(bytes), "NATIVE_TEXT");
}
