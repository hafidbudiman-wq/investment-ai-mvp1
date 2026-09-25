import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { parseFinancialDecimal } from "@/lib/financial/p0a/decimal";
import { createEvidence } from "@/lib/financial/p0a/evidence";
import { runP0ACompatiblePipeline, type P0ACompatiblePipelineResult } from "@/lib/financial/p0a/pipeline";
import type { P0AEvidence, P0APageToken, P0ARoutedPage } from "@/lib/financial/p0a/types";
import type {
  Phase6BDividendEvent,
  Phase6BOutcome,
  Phase6BPipelineInput,
  Phase6BReconciliation,
  Phase6BResult,
  Phase6BSegmentFact,
  Phase6BSegmentIdentity,
} from "@/lib/financial/p0b/phase6b-types";

export const PHASE6B_MANIFEST_VERSION = "INVESTAI_PHASE6B_DIVIDEND_SEGMENT_V1";
export const PHASE6B_EXTRACTOR_VERSION = "phase6b-deterministic-v1";
export const PHASE6B_DIMENSION_SCHEMA_VERSION = "segment-dimension-v1";

const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const clean = (value: string): string => value.normalize("NFKC").replace(/\s+/g, " ").trim();

type VisualLine = { y: number; text: string; tokens: P0APageToken[] };
type NumericCell = { x: number; raw: string; decimal: string; sourceToken: string };

type SegmentAlias = {
  code: string;
  type: "BUSINESS" | "RECONCILIATION";
  patterns: RegExp[];
};

const SEGMENT_ALIASES: SegmentAlias[] = [
  { code: "NUTRITION_SPECIAL_FOODS", type: "BUSINESS", patterns: [/nutrition\s+and\s+special\s+foods/i] },
  { code: "FOOD_SEASONINGS", type: "BUSINESS", patterns: [/food\s+seasonings/i] },
  { code: "SNACK_FOODS", type: "BUSINESS", patterns: [/snack\s+foods/i] },
  { code: "EXPLORATION_PRODUCTION_OIL_GAS", type: "BUSINESS", patterns: [/exploration[\s\S]{0,40}?production[\s\S]{0,30}?oil\s+and\s+gas/i] },
  { code: "HOLDING_RELATED_OPERATIONS", type: "BUSINESS", patterns: [/holding\s+and\s+related\s+operations/i] },
  { code: "DISCONTINUED_OPERATIONS", type: "RECONCILIATION", patterns: [/discontinued\s+operations/i] },
  { code: "TWO_WHEELS", type: "BUSINESS", patterns: [/two\s+wheels(?:\s+segment)?/i, /segmen\s+roda\s+dua/i] },
  { code: "FOUR_WHEELS", type: "BUSINESS", patterns: [/four\s+wheels(?:\s+segment)?/i, /segmen\s+roda\s+empat/i] },
  { code: "OTHER_SEGMENTS", type: "BUSINESS", patterns: [/other\s+segments?/i, /segmen\s+lain-?lain/i] },
  { code: "NOODLES", type: "BUSINESS", patterns: [/noodles?\*?/i] },
  { code: "DAIRY", type: "BUSINESS", patterns: [/\bdairy\b/i] },
  { code: "BEVERAGES", type: "BUSINESS", patterns: [/\bbeverages?\b/i] },
  { code: "SERVICES", type: "BUSINESS", patterns: [/\bservices?\b/i] },
  { code: "POWER", type: "BUSINESS", patterns: [/\bpower\b/i] },
  { code: "TRADING", type: "BUSINESS", patterns: [/\btrading\b/i] },
  { code: "ELIMINATION", type: "RECONCILIATION", patterns: [/\belimination\b/i] },
  { code: "CONSOLIDATED_TOTAL", type: "RECONCILIATION", patterns: [/\bconsolidation\b/i, /\btotal\s+segments?\b/i, /\bjumlah\s+segmen\b/i, /^total$/i] },
];

type RowSpec = {
  metricCode: "REVENUE" | "OPERATING_PROFIT";
  salesScope: "EXTERNAL" | "INTERSEGMENT" | "TOTAL" | null;
  label: string;
  anchors: RegExp[];
};

const ROW_SPECS: RowSpec[] = [
  { metricCode: "OPERATING_PROFIT", salesScope: null, label: "Segment Income from Operations", anchors: [/laba\s+usaha\s+segmen/i, /segment\s+income\s+from\s+operations/i] },
  { metricCode: "REVENUE", salesScope: "INTERSEGMENT", label: "Inter-segment Sales", anchors: [/penjualan\s+antar\s+segmen/i, /inter-?segment\s+sales/i] },
  { metricCode: "REVENUE", salesScope: "TOTAL", label: "Total Segment Revenue", anchors: [/total\s+penjualan\s+neto/i, /total\s+net\s+sales/i, /jumlah\s+penjualan\s+dan\s+pendapatan\s+usaha\s+lainnya/i, /total\s+sales\s+and\s+other\s+operating\s+revenues/i] },
  { metricCode: "REVENUE", salesScope: "EXTERNAL", label: "External Revenue", anchors: [/penjualan\s+kepada[\s\S]{0,100}?pelanggan\s+eksternal/i, /sales\s+to\s+external[\s\S]{0,160}?customers/i, /penjualan\s+eksternal/i, /external\s+sales/i, /pendapatan\s+ekstern/i, /external\s+revenue/i] },
];

function visualLines(page: P0ARoutedPage): VisualLine[] {
  const sorted = [...page.tokens].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: VisualLine[] = [];
  for (const token of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate.y - token.y) <= 1.25);
    if (line) line.tokens.push(token);
    else lines.push({ y: token.y, text: "", tokens: [token] });
  }
  for (const line of lines) {
    line.tokens.sort((a, b) => a.x - b.x);
    line.text = clean(line.tokens.map((token) => token.text).join(" "));
  }
  return lines.sort((a, b) => b.y - a.y);
}

function cells(line: VisualLine): NumericCell[] {
  const output: NumericCell[] = [];
  for (let index = 0; index < line.tokens.length; index += 1) {
    const token = line.tokens[index];
    const parsed = parseFinancialDecimal(token.text);
    if (!parsed) continue;
    const previous = line.tokens[index - 1];
    const next = line.tokens[index + 1];
    const wrapped = previous?.text === "(" && next?.text === ")" && Math.abs(previous.x + previous.width - token.x) < 3;
    const raw = wrapped ? `(${token.text})` : token.text;
    const value = wrapped && !parsed.decimal.startsWith("-") ? new Prisma.Decimal(parsed.decimal).negated().toFixed() : parsed.decimal;
    output.push({ x: token.x, raw, decimal: value, sourceToken: token.text });
  }
  return output;
}

function rowMatch(lines: VisualLine[], index: number): { spec: RowSpec; sourceLabel: string } | null {
  const source = [lines[index].text];
  for (let cursor = index - 1; cursor >= 0 && source.length < 7; cursor -= 1) {
    if (cells(lines[cursor]).length >= 3) break;
    source.unshift(lines[cursor].text);
  }
  const window = clean(source.join(" "));
  const matches = ROW_SPECS.flatMap((spec) => spec.anchors.map((anchor) => {
    const match = anchor.exec(window);
    const sourceLabel = match ? clean(match[0].split(/\s+/).filter((token) => !parseFinancialDecimal(token) && !/^[()\-–—]+$/.test(token)).join(" ")) : "";
    return match ? { spec, index: match.index, sourceLabel } : null;
  })).filter((match): match is { spec: RowSpec; index: number; sourceLabel: string } => match !== null);
  return matches.sort((a, b) => b.index - a.index)[0] ?? null;
}

function rowSpec(lines: VisualLine[], index: number): RowSpec | null {
  return rowMatch(lines, index)?.spec ?? null;
}

function currentPeriodRow(lines: VisualLine[], rowIndex: number, expectedYear: string): boolean {
  const row = lines[rowIndex];
  const dates = lines
    .filter((line) => line.y > row.y + 2 && line.y < row.y + 260 && /\b(?:19|20)\d{2}\b/.test(line.text))
    .sort((a, b) => a.y - b.y);
  const nearest = dates[0];
  return nearest ? nearest.text.includes(expectedYear) : false;
}

function periodColumn(lines: VisualLine[], rowIndex: number, expectedYear: string): string {
  const row = lines[rowIndex];
  return lines
    .filter((line) => line.y > row.y + 2 && line.y < row.y + 260 && line.text.includes(expectedYear))
    .sort((a, b) => a.y - b.y)[0]?.text ?? expectedYear;
}

function sourceMetricLabel(lines: VisualLine[], rowIndex: number): string {
  return rowMatch(lines, rowIndex)?.sourceLabel ?? clean(lines[rowIndex].tokens
    .filter((token) => !parseFinancialDecimal(token.text) && !/^[()\-–—]+$/.test(token.text))
    .map((token) => token.text)
    .join(" "));
}

function headerGroups(page: P0ARoutedPage, headerRow: VisualLine, numeric: NumericCell[]): string[] {
  const boundaries = numeric.map((cell, index) => index === numeric.length - 1 ? Number.POSITIVE_INFINITY : (cell.x + numeric[index + 1].x) / 2);
  const lower = numeric.map((cell, index) => index === 0 ? Math.max(0, cell.x - 45) : boundaries[index - 1]);
  const candidates = page.tokens.filter((token) => token.y > headerRow.y + 4 && token.y < headerRow.y + 105 && token.x + token.width / 2 >= lower[0] && token.x + token.width / 2 <= numeric.at(-1)!.x + 75);
  return numeric.map((_cell, index) => clean(candidates
    .filter((token) => {
      const center = token.x + token.width / 2;
      return center >= lower[index] && center < boundaries[index];
    })
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((token) => token.text)
    .join(" ")));
}

function identifySegment(rawHeader: string): { sourceLabel: string; normalizedLabel: string; segmentType: "BUSINESS" | "RECONCILIATION" } | null {
  for (const alias of SEGMENT_ALIASES) {
    for (const pattern of alias.patterns) {
      const match = pattern.exec(rawHeader);
      if (match) return { sourceLabel: clean(match[0]), normalizedLabel: alias.code, segmentType: alias.type };
    }
  }
  return null;
}

function evidenceSnippet(page: P0ARoutedPage, anchor: string, before = 900, after = 900): string {
  const index = page.text.indexOf(anchor);
  if (index < 0) return page.text.slice(0, Math.min(page.text.length, before + after));
  return page.text.slice(Math.max(0, index - before), Math.min(page.text.length, index + anchor.length + after));
}

function pageTextVariants(page: P0ARoutedPage): string[] {
  const width = Math.max(...page.tokens.map((token) => token.x + token.width), 0);
  const midpoint = width / 2;
  const columnText = (side: "LEFT" | "RIGHT") => visualLines(page)
    .map((line) => clean(line.tokens
      .filter((token) => side === "LEFT" ? token.x + token.width / 2 < midpoint : token.x + token.width / 2 >= midpoint)
      .map((token) => token.text)
      .join(" ")))
    .filter(Boolean)
    .join("\n");
  return [page.text, columnText("LEFT"), columnText("RIGHT")];
}

function segmentExtraction(page: P0ARoutedPage, context: Phase6BPipelineInput["context"], documentSha256: string) {
  const lines = visualLines(page);
  const headerRow = lines.find((line, index) => cells(line).length >= 3 && currentPeriodRow(lines, index, context.periodEnd.slice(0, 4)) && rowSpec(lines, index));
  if (!headerRow) return [];
  const headers = headerGroups(page, headerRow, cells(headerRow));
  const identified = headers.map(identifySegment);
  if (identified.some((item) => item === null)) return [];
  const result: Array<{ identity: Phase6BSegmentIdentity; fact: Phase6BSegmentFact }> = [];
  for (const [index, line] of lines.entries()) {
    const numeric = cells(line);
    if (numeric.length < 3 || !currentPeriodRow(lines, index, context.periodEnd.slice(0, 4))) continue;
    const spec = rowSpec(lines, index);
    if (!spec) continue;
    const rawMetricLabel = sourceMetricLabel(lines, index);
    const rawPeriodColumn = periodColumn(lines, index, context.periodEnd.slice(0, 4));
    const rowSnippet = evidenceSnippet(page, numeric[0].sourceToken);
    for (let column = 0; column < numeric.length; column += 1) {
      const segment = identified[column]!;
      const identityKey = sha([context.ticker, segment.normalizedLabel, segment.segmentType, context.periodStart, context.periodEnd, PHASE6B_DIMENSION_SCHEMA_VERSION].join("|"));
      const identityEvidence = createEvidence({
        requirementId: "SEGMENT_IDENTITY",
        page,
        statement: "NOTE",
        table: "Segment Information",
        rowLabel: "Segment header",
        columnLabel: segment.sourceLabel,
        rawValue: segment.sourceLabel,
        snippet: rowSnippet,
      });
      const reported = numeric[column].decimal;
      const normalized = new Prisma.Decimal(reported).mul(context.documentScale).toFixed();
      const dimensionHash = sha(JSON.stringify({ segment: segment.normalizedLabel, type: segment.segmentType, salesScope: spec.salesScope, schema: PHASE6B_DIMENSION_SCHEMA_VERSION }));
      const factKey = sha([documentSha256, context.periodStart, context.periodEnd, identityKey, spec.metricCode, spec.salesScope ?? "", reported, numeric[column].raw, page.textHash].join("|"));
      const factEvidence = createEvidence({
        requirementId: spec.metricCode === "REVENUE" ? "SEGMENT_REVENUE" : "SEGMENT_OPERATING_PROFIT",
        page,
        statement: "NOTE",
        table: "Segment Information",
        rowLabel: rawMetricLabel,
        columnLabel: segment.sourceLabel,
        rawValue: numeric[column].raw,
        snippet: rowSnippet,
      });
      result.push({
        identity: { identityKey, sourceLabel: segment.sourceLabel, normalizedLabel: segment.normalizedLabel, segmentType: segment.segmentType, validFrom: context.periodStart, validTo: context.periodEnd, evidence: [identityEvidence] },
        fact: {
          factKey,
          segmentIdentityKey: identityKey,
          metricCode: spec.metricCode,
          metricLabel: spec.label,
          sourceMetricLabel: rawMetricLabel,
          periodColumn: rawPeriodColumn,
          salesScope: spec.salesScope,
          state: new Prisma.Decimal(reported).isZero() ? "ZERO" : "VALUE",
          reportedValue: reported,
          normalizedValue: normalized,
          rawValue: numeric[column].raw,
          currency: context.currency,
          unitType: "DOCUMENT_CURRENCY",
          scale: context.documentScale,
          period: { start: context.periodStart, end: context.periodEnd, type: context.periodType },
          consolidationScope: context.consolidated === true ? "CONSOLIDATED" : context.consolidated === false ? "STANDALONE" : "UNKNOWN",
          dimensionHash,
          sourceDocumentSha256: documentSha256,
          extractionOrigin: page.sourceType ?? "NATIVE",
          evidence: [factEvidence],
          confidence: { read: page.sourceType === "OCR" ? page.sourceMetadata?.numericMeanConfidence ?? 0 : 1, mapping: 0.995 },
          validationStatus: "VALIDATED",
        },
      });
    }
  }
  return result;
}

const MONTHS: Record<string, number> = {
  januari: 1, january: 1, februari: 2, february: 2, maret: 3, march: 3, april: 4, mei: 5, may: 5,
  juni: 6, june: 6, juli: 7, july: 7, agustus: 8, august: 8, september: 9, oktober: 10, october: 10,
  november: 11, desember: 12, december: 12,
};

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = clean(raw.replace(/,/g, " "));
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(value);
  const monthFirst = /^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/.exec(value);
  const parts = dayFirst ? { day: dayFirst[1], month: dayFirst[2], year: dayFirst[3] } : monthFirst ? { day: monthFirst[2], month: monthFirst[1], year: monthFirst[3] } : null;
  if (!parts || !MONTHS[parts.month.toLowerCase()]) return null;
  return `${parts.year}-${String(MONTHS[parts.month.toLowerCase()]).padStart(2, "0")}-${parts.day.padStart(2, "0")}`;
}

function amount(raw: string, scale: string): { reportedValue: string; normalizedValue: string; rawValue: string; scale: string } | null {
  const parsed = parseFinancialDecimal(raw);
  if (!parsed) return null;
  return { reportedValue: parsed.decimal, normalizedValue: new Prisma.Decimal(parsed.decimal).mul(scale).toFixed(), rawValue: raw, scale };
}

type DividendCapture = {
  total: string;
  totalCurrency: string;
  per: string;
  perCurrency: string;
  profitYear: string;
  declarationDate?: string;
  approvalDate?: string;
  recordDate?: string;
  paymentDate?: string;
  paymentMonth?: string;
  eventType?: "FINAL" | "INTERIM";
  anchor: string;
};

function captureDividend(page: P0ARoutedPage, reportYear: string): DividendCapture | null {
  for (const text of pageTextVariants(page)) {
    const paired = /cash\s+dividends\s+amounting\s+to\s+(Rp)\s*([\d.,]+)\s*\(full\s+amount\)\s*per\s+share\s+or\s+totaling\s+(Rp)\s*([\d.,]+)\s+in\s+(\d{4})/i.exec(text);
    if (paired && paired[5] === reportYear) {
      const approval = /AGSM\s+held\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i.exec(text)?.[1]
        ?? /RUPST[\s\S]{0,80}?tanggal\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(text)?.[1];
      const month = /paid[\s\S]{0,100}?in\s+([A-Za-z]+\s+\d{4})/i.exec(text)?.[1];
      return { perCurrency: paired[1], per: paired[2], totalCurrency: paired[3], total: paired[4], profitYear: String(Number(reportYear) - 1), approvalDate: approval, paymentMonth: month, eventType: "FINAL", anchor: paired[0] };
    }

    const paragraphStarts = [...text.matchAll(/Pada\s+tanggal\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/gi)];
    for (const start of paragraphStarts) {
      if (!parseDate(start[1])?.startsWith(reportYear)) continue;
      const paragraph = text.slice(start.index, Math.min(text.length, (start.index ?? 0) + 1200));
      const approval = /RUPST\s+tertanggal\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(paragraph)?.[1];
      const total = /sebesar\s+(AS\$|US\$|Rp)\s*([\d.,]+)/i.exec(paragraph);
      const profitYear = /tahun\s+buku\s+(\d{4})/i.exec(paragraph)?.[1];
      const per = /senilai\s+(Rp|AS\$|US\$)\s*([\d.,]+)\s+per/i.exec(paragraph);
      const payment = /dibayarkan\s+pada\s+tanggal\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(paragraph)?.[1];
      if (approval && total && profitYear && per && payment) {
        return { declarationDate: start[1], approvalDate: approval, totalCurrency: total[1], total: total[2], profitYear, perCurrency: per[1], per: per[2], paymentDate: payment, eventType: "FINAL", anchor: paragraph };
      }
    }

    const minutes = /Minutes\s+of\s+Annual\s+General\s+Meeting[\s\S]{0,120}?dated\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})[\s\S]{0,160}?cash\s+dividends\s+of\s+(\d{4})\s+amounting\s+to\s+(Rp|AS\$|US\$)\s*([\d.,]+)\s+or\s+(Rp|AS\$|US\$)\s*([\d.,]+)\s+per\s+share[\s\S]{0,180}?shareholders\s+on\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(text);
    if (minutes && parseDate(minutes[1])?.startsWith(reportYear)) {
      return { approvalDate: minutes[1], profitYear: minutes[2], totalCurrency: minutes[3], total: minutes[4], perCurrency: minutes[5], per: minutes[6], recordDate: minutes[7], eventType: "FINAL", anchor: minutes[0] };
    }
  }
  return null;
}

function paymentLineForAmount(page: P0ARoutedPage, expected: string): VisualLine | null {
  return visualLines(page).find((line) =>
    /pembayaran\s+dividen\s+kas|payments?\s+of\s+cash\s+dividends?/i.test(line.text)
    && cells(line).some((cell) => cell.decimal === expected),
  ) ?? null;
}

function currency(raw: string): string {
  return /AS\$|US\$/i.test(raw) ? "USD" : /Rp/i.test(raw) ? "IDR" : raw.toUpperCase();
}

function eventEvidence(page: P0ARoutedPage, fieldName: string, rawValue: string, snippet: string): P0AEvidence {
  return createEvidence({ requirementId: `DIVIDEND_EVENT.${fieldName}`, page, statement: "NOTE", table: "Dividend disclosure", rowLabel: "Dividend event", columnLabel: fieldName, rawValue, snippet });
}

function dividendExtraction(pages: readonly P0ARoutedPage[], p0a: P0ACompatiblePipelineResult, context: Phase6BPipelineInput["context"], documentSha256: string): Phase6BDividendEvent[] {
  const reportYear = context.periodEnd.slice(0, 4);
  const candidates = pages.filter((page) => /(?:dividen\s+(?:kas|tunai)|cash\s+dividends?)/i.test(page.text) && /per\s+(?:lembar\s+)?saham|per\s+shares?/i.test(page.text));
  for (const page of candidates) {
    const capture = captureDividend(page, reportYear);
    if (!capture) continue;
    const totalScale = currency(capture.totalCurrency) === context.currency ? context.documentScale : "1";
    const total = amount(capture.total, totalScale);
    const perShare = amount(capture.per, "1");
    if (!total || !perShare) continue;
    const approval = parseDate(capture.approvalDate);
    const declaration = parseDate(capture.declarationDate);
    const record = parseDate(capture.recordDate);
    const payment = parseDate(capture.paymentDate);
    let paymentPrecision: "DAY" | "MONTH" | "PERIOD" | null = payment ? "DAY" : capture.paymentMonth ? "MONTH" : null;
    let paymentRaw = capture.paymentDate ?? capture.paymentMonth ?? null;
    let status: Phase6BDividendEvent["status"] = payment || capture.paymentMonth ? "PAID" : "APPROVED";
    const snippet = evidenceSnippet(page, capture.anchor.slice(0, Math.min(80, capture.anchor.length)), 500, 700);
    const evidence: Phase6BDividendEvent["evidence"] = [];
    const add = (fieldName: string, raw: string | null) => { if (raw) evidence.push({ fieldName, evidence: eventEvidence(page, fieldName, raw, snippet) }); };
    add("TOTAL_AMOUNT", capture.total);
    add("PER_SHARE_AMOUNT", capture.per);
    add("DECLARATION_DATE", capture.declarationDate ?? null);
    add("APPROVAL_DATE", capture.approvalDate ?? null);
    add("RECORD_DATE", capture.recordDate ?? null);
    add("PAYMENT_DATE", capture.paymentDate ?? capture.paymentMonth ?? null);

    if (status !== "PAID") {
      const paymentPage = pages.find((candidate) => {
        return paymentLineForAmount(candidate, total.reportedValue);
      });
      if (paymentPage) {
        const rawPeriod = /FOR\s+THE\s+YEAR\s+ENDED\s+31\s+DECEMBER\s+\d{4}/i.exec(paymentPage.text)?.[0]
          ?? /UNTUK\s+TAHUN\s+YANG\s+BERAKHIR\s+PADA\s+31\s+DESEMBER\s+\d{4}/i.exec(paymentPage.text)?.[0]
          ?? `${context.periodType} period ended ${context.periodEnd}`;
        const paymentAnchor = paymentLineForAmount(paymentPage, total.reportedValue)?.tokens[0]?.text ?? capture.total;
        const paymentSnippet = evidenceSnippet(paymentPage, paymentAnchor, 400, 400);
        evidence.push({ fieldName: "PAYMENT_STATUS", evidence: eventEvidence(paymentPage, "PAYMENT_STATUS", capture.total, paymentSnippet) });
        status = "PAID";
        paymentPrecision = "PERIOD";
        paymentRaw = rawPeriod;
      }
    }

    const sourceStart = `${capture.profitYear}-01-01`;
    const sourceEnd = `${capture.profitYear}-12-31`;
    const eventKey = sha([documentSha256, capture.eventType ?? "FINAL", approval ?? declaration ?? "", sourceStart, sourceEnd, total.normalizedValue, perShare.normalizedValue, "PARENT_SHAREHOLDERS", page.textHash].join("|"));
    const dateFields = { declaration, approval, record, cum: null, ex: null, payment, paymentPrecision, paymentRaw };
    const fieldStates = Object.fromEntries(Object.entries({ total: total.normalizedValue, perShare: perShare.normalizedValue, ...dateFields }).map(([key, value]) => [key, value === null ? "FIELD_NOT_DISCLOSED" : "VALUE"])) as Phase6BDividendEvent["fieldStates"];
    const controls: string[] = [];
    const shares = p0a.outcomes.find((outcome) => outcome.requirementId === "SHARES_ISSUED_REPORTED")?.reportedObservation;
    if (shares?.decimalValue && currency(capture.totalCurrency) === currency(capture.perCurrency)) {
      const calculated = new Prisma.Decimal(perShare.normalizedValue).mul(shares.decimalValue);
      const difference = new Prisma.Decimal(total.normalizedValue).minus(calculated).abs();
      const ratio = new Prisma.Decimal(total.normalizedValue).isZero() ? new Prisma.Decimal(0) : difference.div(new Prisma.Decimal(total.normalizedValue).abs());
      controls.push(`DPS_X_ISSUED_SHARES_DIFFERENCE=${difference.toFixed()}; within_1ppm=${ratio.lessThanOrEqualTo("0.000001")}`);
    }
    return [{
      eventKey,
      eventType: capture.eventType ?? "OTHER",
      status,
      sourceProfitPeriod: { start: sourceStart, end: sourceEnd },
      dates: dateFields,
      recipientScope: "PARENT_SHAREHOLDERS",
      shareClass: "ORDINARY",
      total: { ...total, currency: currency(capture.totalCurrency) },
      perShare: { ...perShare, currency: currency(capture.perCurrency) },
      fieldStates,
      evidence,
      extractionOrigin: page.sourceType ?? "NATIVE",
      confidence: { read: page.sourceType === "OCR" ? page.sourceMetadata?.numericMeanConfidence ?? 0 : 1, mapping: 0.995 },
      validation: { status: "VALIDATED", controls },
    }];
  }
  return [];
}

function deDuplicateSegments(extracted: ReturnType<typeof segmentExtraction>) {
  const identityMap = new Map<string, Phase6BSegmentIdentity>();
  const factMap = new Map<string, Phase6BSegmentFact>();
  for (const item of extracted) {
    const existing = identityMap.get(item.identity.identityKey);
    if (!existing) identityMap.set(item.identity.identityKey, item.identity);
    else if (!existing.evidence.some((evidence) => evidence.evidenceHash === item.identity.evidence[0]?.evidenceHash)) existing.evidence.push(...item.identity.evidence);
    factMap.set(item.fact.factKey, item.fact);
  }
  return { identities: [...identityMap.values()], facts: [...factMap.values()] };
}

function reconciliation(facts: Phase6BSegmentFact[], events: Phase6BDividendEvent[], p0a: P0ACompatiblePipelineResult): Phase6BReconciliation[] {
  const controls: Phase6BReconciliation[] = [];
  for (const scope of ["EXTERNAL", "TOTAL"] as const) {
    const rows = facts.filter((fact) => fact.metricCode === "REVENUE" && fact.salesScope === scope);
    const total = rows.find((fact) => fact.segmentIdentityKey && fact.evidence[0]?.columnLabel && /total|consolidation/i.test(fact.evidence[0].columnLabel));
    const members = rows.filter((fact) => fact !== total);
    const applicable = Boolean(total && members.length);
    const sum = applicable ? members.reduce((value, fact) => value.plus(fact.normalizedValue), new Prisma.Decimal(0)) : null;
    const difference = applicable ? sum!.minus(total!.normalizedValue) : null;
    controls.push({ controlId: `SEGMENT_REVENUE_${scope}_RECONCILIATION`, applicable, passed: applicable ? difference!.isZero() : null, reportedValue: total?.normalizedValue ?? null, comparedValue: sum?.toFixed() ?? null, difference: difference?.toFixed() ?? null, reason: applicable ? "Business and explicit elimination/unallocated members compared with the disclosed consolidated/total member." : "No explicit comparable total member was disclosed." });
  }
  const operating = facts.filter((fact) => fact.metricCode === "OPERATING_PROFIT");
  const operatingTotal = operating.find((fact) => /total|consolidation/i.test(fact.evidence[0]?.columnLabel ?? ""));
  const operatingMembers = operating.filter((fact) => fact !== operatingTotal);
  const operatingSum = operatingTotal && operatingMembers.length ? operatingMembers.reduce((value, fact) => value.plus(fact.normalizedValue), new Prisma.Decimal(0)) : null;
  controls.push({ controlId: "SEGMENT_OPERATING_PROFIT_RECONCILIATION", applicable: Boolean(operatingTotal && operatingMembers.length), passed: operatingSum ? operatingSum.equals(operatingTotal!.normalizedValue) : null, reportedValue: operatingTotal?.normalizedValue ?? null, comparedValue: operatingSum?.toFixed() ?? null, difference: operatingSum ? operatingSum.minus(operatingTotal!.normalizedValue).toFixed() : null, reason: operatingSum ? "Explicit segment operating-profit members compared with the disclosed segment total; unallocated corporate items remain outside the member sum." : "Canonical segment operating profit was not explicitly disclosed." });

  for (const event of events) {
    const shares = p0a.outcomes.find((outcome) => outcome.requirementId === "SHARES_ISSUED_REPORTED")?.reportedObservation?.decimalValue;
    const applicable = Boolean(shares && event.total && event.perShare && event.total.currency === event.perShare.currency);
    const calculated = applicable ? new Prisma.Decimal(event.perShare!.normalizedValue).mul(shares!) : null;
    const difference = calculated ? new Prisma.Decimal(event.total!.normalizedValue).minus(calculated) : null;
    const ratio = difference && event.total ? difference.abs().div(new Prisma.Decimal(event.total.normalizedValue).abs()) : null;
    controls.push({ controlId: "DIVIDEND_DPS_ELIGIBLE_SHARE_CONTROL", applicable, passed: ratio ? ratio.lessThanOrEqualTo("0.000001") : null, reportedValue: event.total?.normalizedValue ?? null, comparedValue: calculated?.toFixed() ?? null, difference: difference?.toFixed() ?? null, reason: applicable ? "DPS multiplied by reported issued shares is an approximate control only; treasury/eligible-share timing can differ." : "Control not run because currencies differ or no directly comparable reported share count exists." });
  }
  return controls;
}

function outcomes(events: Phase6BDividendEvent[], facts: Phase6BSegmentFact[], pages: readonly P0ARoutedPage[]): Phase6BOutcome[] {
  const dividendPages = pages.filter((page) => /dividen|dividend/i.test(page.text)).map((page) => page.pageNumber);
  const segmentPages = pages.filter((page) => /informasi\s+segmen|segment\s+information|segmen\s+operasi|operation\s+segment/i.test(page.text)).map((page) => page.pageNumber);
  const revenue = facts.filter((fact) => fact.metricCode === "REVENUE");
  const operating = facts.filter((fact) => fact.metricCode === "OPERATING_PROFIT");
  const sourceDefinedNonOperating = pages.some((page) => /hasil\s+segmen|segment\s+results|laba\s+kotor|gross\s+profit/i.test(page.text));
  return [
    { requirementId: "DIVIDEND_EVENT", applicability: "EXPECTED", state: events.length ? "VALUE" : "NOT_DISCLOSED", factCount: events.length, attemptedPages: dividendPages, reason: events.length ? "Source-disclosed dividend lifecycle event retained with field-level evidence and true dates." : "No qualifying dividend declaration/approval event was disclosed for the reporting period." },
    { requirementId: "SEGMENT_REVENUE", applicability: "EXPECTED", state: revenue.length ? "VALUE" : "MISSING", factCount: revenue.length, attemptedPages: segmentPages, reason: revenue.length ? "Source-disclosed segment revenue retained with segment and sales-scope dimensions." : "Expected reportable segment revenue was not resolved." },
    { requirementId: "SEGMENT_OPERATING_PROFIT", applicability: "OPTIONAL", state: operating.length ? "VALUE" : "NOT_DISCLOSED", factCount: operating.length, attemptedPages: segmentPages, reason: operating.length ? "Issuer explicitly disclosed a segment measure semantically supported as income from operations." : sourceDefinedNonOperating ? "Issuer disclosed another segment performance measure (for example gross profit, segment result, or profit before tax); it was not relabeled as canonical operating profit." : "No issuer-supported segment operating-profit measure was disclosed." },
  ];
}

export async function runPhase6B(input: Phase6BPipelineInput): Promise<Phase6BResult> {
  const p0a = input.p0aResult ?? await runP0ACompatiblePipeline({ bytes: input.bytes, context: input.context });
  const documentSha256 = sha(input.bytes);
  const candidateSegmentPages = p0a.routedPages.filter((page) => /informasi\s+segmen|segment\s+information|segmen\s+operasi|operation\s+segment/i.test(page.text));
  const extracted = candidateSegmentPages.flatMap((page) => segmentExtraction(page, input.context, documentSha256));
  const { identities, facts } = deDuplicateSegments(extracted);
  const dividendEvents = dividendExtraction(p0a.routedPages, p0a, input.context, documentSha256);
  const resultOutcomes = outcomes(dividendEvents, facts, p0a.routedPages);
  const selectedPages = [...new Set([
    ...dividendEvents.flatMap((event) => event.evidence.map((link) => link.evidence.pageNumber)),
    ...facts.flatMap((fact) => fact.evidence.map((evidence) => evidence.pageNumber)),
  ])].sort((a, b) => a - b);
  const p0aFingerprint = sha(JSON.stringify(p0a.outcomes.map((outcome) => ({ requirementId: outcome.requirementId, state: outcome.state, value: outcome.reportedObservation?.decimalValue ?? null, evidence: outcome.reportedObservation?.evidence.map((evidence) => evidence.evidenceHash) ?? [] }))));
  const runIdentity = sha(JSON.stringify({ documentSha256, context: input.context, manifest: PHASE6B_MANIFEST_VERSION, extractor: PHASE6B_EXTRACTOR_VERSION, dimensionSchema: PHASE6B_DIMENSION_SCHEMA_VERSION }));
  return {
    manifestVersion: PHASE6B_MANIFEST_VERSION,
    extractorVersion: PHASE6B_EXTRACTOR_VERSION,
    dimensionSchemaVersion: PHASE6B_DIMENSION_SCHEMA_VERSION,
    context: input.context,
    documentSha256,
    p0a: { outcomeFingerprint: p0aFingerprint, ocrPages: p0a.ocrUsage.ocrPages, reusedOcrPages: p0a.ocrUsage.reusedOcrPages, versions: p0a.versions },
    selectedPages,
    dividendEvents,
    segmentIdentities: identities,
    segmentFacts: facts,
    outcomes: resultOutcomes,
    reconciliations: reconciliation(facts, dividendEvents, p0a),
    providerUsage: { providerCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: "0.00000000" },
    runIdentity,
  };
}
