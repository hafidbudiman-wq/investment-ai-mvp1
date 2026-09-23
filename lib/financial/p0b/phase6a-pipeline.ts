import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { createEvidence } from "@/lib/financial/p0a/evidence";
import { parseFinancialDecimal } from "@/lib/financial/p0a/decimal";
import { runP0ACompatiblePipeline } from "@/lib/financial/p0a/pipeline";
import type { P0ACompatiblePipelineResult } from "@/lib/financial/p0a/pipeline";
import type { P0AIssuerContext, P0ARoutedPage } from "@/lib/financial/p0a/types";
import { PHASE6A_EXTRACTOR_VERSION, PHASE6A_FORMULA_BY_CODE, PHASE6A_FORMULA_REGISTRY_VERSION, PHASE6A_MANIFEST_VERSION, PHASE6A_REQUIREMENTS } from "@/lib/financial/p0b/phase6a-registry";
import type { Phase6AInput, Phase6AOutcome, Phase6ARequirement, Phase6AResult } from "@/lib/financial/p0b/types";

const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const NUMBER = /\(\s*\d[\d.,]*\s*\)|[-−–—]\s*\d[\d.,]*|\d[\d.,]*/g;

type ReportedSpec = {
  code: string;
  statements: readonly string[];
  aliases: readonly RegExp[];
  minAbs: string;
  requirePrimary?: boolean;
  reject?: RegExp;
};

const REPORTED_SPECS: readonly ReportedSpec[] = [
  { code: "SHARES_OUTSTANDING_REPORTED", statements: ["NOTE", "CHANGES_IN_EQUITY", "BALANCE_SHEET", "OTHER"], minAbs: "1000000", aliases: [/jumlah\s+saham(?:\s+biasa)?\s+beredar/i, /saham(?:\s+biasa)?\s+yang\s+beredar/i, /total\s+(?:number\s+of\s+)?(?:ordinary\s+)?shares?\s+outstanding/i], reject: /weighted|rata[- ]rata\s+tertimbang/i },
  { code: "TOTAL_DEBT_REPORTED", statements: ["BALANCE_SHEET", "NOTE"], minAbs: "1000", aliases: [/total\s+(?:interest[- ]bearing\s+)?(?:debt|borrowings)\b/i, /total\s+(?:utang|pinjaman)(?:\s+berbunga)?\b/i], reject: /ratio|covenant|to\s+equity|maturity|accounts?\s+payable|utang\s+bukan\s+usaha|pihak\s+berelasi/i },
  { code: "LEASE_LIABILITIES_REPORTED", statements: ["BALANCE_SHEET", "NOTE"], minAbs: "1000", aliases: [/total\s+liabilitas\s+sewa\b/i, /total\s+lease\s+liabilit(?:y|ies)\b/i] },
  { code: "SGA_REPORTED", statements: ["INCOME_STATEMENT", "NOTE"], minAbs: "1000", aliases: [/selling\s*,?\s+general\s+and\s+administrative\s+expenses?/i, /beban\s+penjualan\s*,?\s+umum\s+dan\s+administrasi/i] },
  { code: "EBITDA_REPORTED", statements: ["INCOME_STATEMENT", "NOTE", "OTHER"], minAbs: "1000", aliases: [/(?:^|\n)\s*(?:adjusted\s+)?EBITDA\b/im], reject: /ratio|margin|covenant|to\s+EBITDA/i },
  { code: "INTEREST_EXPENSE_REPORTED", statements: ["INCOME_STATEMENT", "NOTE"], minAbs: "10000", aliases: [/(?:total\s+)?beban\s+bunga\b/i, /(?:total\s+)?interest\s+expense\b/i], reject: /employee\s+benefit|imbalan\s+kerja|interest\s+cost|service\s+cost|lease\s+liabilit|liabilitas\s+sewa|masa\s+depan|future\s+(?:imputed\s+)?interest|tidak\s+terdapat|there\s+(?:is|are)\s+no/i },
  { code: "RESTRICTED_CASH_REPORTED", statements: ["BALANCE_SHEET", "NOTE"], minAbs: "1000", aliases: [/(?:total\s+)?kas\s+yang\s+dibatasi\s+penggunaannya\b/i, /(?:total\s+)?restricted\s+cash\b/i] },
  { code: "OCI_TOTAL_REPORTED", statements: ["INCOME_STATEMENT"], minAbs: "10000", requirePrimary: true, aliases: [/\(\s*rugi\s*\)\s+penghasilan\s+komprehensif[\s\S]{0,60}?lain/i, /(?:\(\s*rugi\s*\)\s*)?penghasilan\s+komprehensif\s+lain\s+(?:periode|tahun)\s+berjalan/i, /r\s*ugi\s+komprehensif\s+lain\s+(?:periode|tahun)\s+berjalan/i, /total\s+other\s+comprehensive\s+(?:income|loss)/i] },
  { code: "TOTAL_COMPREHENSIVE_INCOME_REPORTED", statements: ["INCOME_STATEMENT"], minAbs: "10000", requirePrimary: true, aliases: [/total\s+penghasilan\s+komprehensif[\s\S]{0,80}?tahun\s+berjalan/i, /total\s+(?:laba|penghasilan)\s+komprehensif\s+(?:periode(?:\s*\/\s*tahun)?|tahun)\s+berjalan/i, /jumlah\s+(?:laba|penghasilan)\s+komprehensif\s+(?:periode(?:\s*\/\s*tahun)?|tahun)\s+berjalan/i, /total\s+(?:income|profit)\s+and\s+other\s+comprehensive\s+income/i, /total\s+comprehensive\s+income\s+for\s+the\s+(?:period|year)/i] },
  { code: "CAPEX_PPE_CASH_REPORTED", statements: ["CASH_FLOW"], minAbs: "1000", requirePrimary: true, aliases: [/(?:perolehan|pembelian|penambahan)\s+aset\s+tetap/i, /(?:acquisition|purchase|addition|additions)\s+(?:of|to)\s+(?:property\s*,?\s*plant\s+and\s+equipment|fixed\s+assets?)/i] },
  { code: "CAPEX_INTANGIBLE_CASH_REPORTED", statements: ["CASH_FLOW"], minAbs: "1000", requirePrimary: true, aliases: [/(?:perolehan|pembelian|penambahan)\s+aset\s+(?:tak|tidak)\s+berwujud/i, /(?:acquisition|purchase|addition|additions)\s+(?:of|to)\s+intangible\s+assets?/i] },
  { code: "CAPEX_TOTAL_CASH_REPORTED", statements: ["CASH_FLOW"], minAbs: "1000", requirePrimary: true, aliases: [/total\s+(?:belanja\s+modal|capex)\b/i, /total\s+(?:cash\s+)?capital\s+expenditure/i] },
];

const COMPONENT_SPECS: readonly ReportedSpec[] = [
  { code: "LEASE_CURRENT_COMPONENT", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/LIABILITAS\s+JANGKA\s+PENDEK[\s\S]{0,1400}?Lia?b?ilitas\s+sewa/i, /CURRENT\s+LIABILITIES[\s\S]{0,1400}?Lease\s+liabilit(?:y|ies)/i] },
  { code: "LEASE_NONCURRENT_COMPONENT", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/LIABILITAS\s+JANGKA\s+PANJANG[\s\S]{0,1400}?Lia?b?ilitas\s+sewa/i, /NON[- ]CURRENT\s+LIABILITIES[\s\S]{0,1400}?Lease\s+liabilit(?:y|ies)/i] },
  { code: "SELLING_DISTRIBUTION_COMPONENT", statements: ["INCOME_STATEMENT"], minAbs: "1000", requirePrimary: true, aliases: [/beban\s+penjualan\s+dan\s+(?:distribusi|pemasaran)/i, /selling\s+and\s+(?:distribution|marketing)\s+expenses?/i] },
  { code: "GENERAL_ADMIN_COMPONENT", statements: ["INCOME_STATEMENT"], minAbs: "1000", requirePrimary: true, aliases: [/beban\s+umum\s+dan\s+administrasi/i, /general\s+and\s+administrative\s+expenses?/i] },
  { code: "CAPEX_EXPLORATION_COMPONENT", statements: ["CASH_FLOW"], minAbs: "1000", requirePrimary: true, aliases: [/penambahan\s+aset\s+eksplorasi\s+dan\s+evaluasi/i, /addition(?:s)?\s+to\s+exploration\s+and\s+evaluation\s+assets?/i] },
  { code: "CAPEX_CONCESSION_COMPONENT", statements: ["CASH_FLOW"], minAbs: "1000", requirePrimary: true, aliases: [/penambahan\s+pada\s+aset\s+konsesi/i, /addition(?:s)?\s+to\s+concession/i] },
  { code: "CAPEX_OIL_GAS_COMPONENT", statements: ["CASH_FLOW"], minAbs: "1000", requirePrimary: true, aliases: [/penambahan\s+aset\s+minyak\s+dan\s+gas\s+bumi/i, /addition(?:s)?\s+to\s+oil\s+and\s+gas\s+propert/i] },
  { code: "CAPEX_PPE_ADVANCE_COMPONENT", statements: ["CASH_FLOW"], minAbs: "1000", requirePrimary: true, aliases: [/penambahan\s+uang\s+muka\s+untuk\s+aset\s+tetap/i, /addition(?:s)?\s+(?:to|for)\s+advance(?:s)?\s+(?:for\s+)?(?:purchase\s+of\s+)?(?:property\s*,?\s*plant\s+and\s+equipment|fixed\s+assets?)/i] },
  { code: "OCF_COMPONENT", statements: ["CASH_FLOW"], minAbs: "1000", requirePrimary: true, aliases: [/kas\s+neto\s+(?:yang\s+)?(?:diperoleh|disediakan)\s+dari\s+aktivitas\s+operasi/i, /net\s+cash\s+(?:provided\s+by|from|used\s+in)\s+operating\s+activities/i] },
  { code: "DEBT_SHORT_BANK_DIRECT", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/LIABILITAS\s+JANGKA\s+PENDEK[\s\S]{0,800}?(?:Utang|Pinjaman)\s+bank\s+jangka\s+pendek(?:[\s\S]{0,80}?(?:cerukan|overdraft|trust\s+receipts?))?/i] },
  { code: "DEBT_CURRENT_MATURITY_BANK", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/(?:Bagian\s+)?(?:Utang|Pinjaman)\s+jangka\s+panjang\s+yang\s+(?:akan\s+)?[\s\S]{0,80}?jatuh[\s\S]{0,360}?(?:Utang|Pinjaman)\s+bank\b/i] },
  { code: "DEBT_CURRENT_MATURITY_NONBANK", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/(?:Bagian\s+)?(?:Utang|Pinjaman)\s+jangka\s+panjang\s+yang\s+(?:akan\s+)?[\s\S]{0,80}?jatuh[\s\S]{0,600}?Pinjaman\s+dari\s+instansi\s+keuangan\s+non[- ]bank/i] },
  { code: "DEBT_CURRENT_MATURITY_RUPIAH_BONDS", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/(?:Bagian\s+)?(?:Utang|Pinjaman)\s+jangka\s+panjang\s+yang\s+(?:akan\s+)?[\s\S]{0,80}?jatuh[\s\S]{0,800}?Obligasi\s+Rupiah/i] },
  { code: "DEBT_NONCURRENT_BANK", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/LIABILITAS\s+JANGKA\s+PANJANG[\s\S]{0,700}?(?:Utang|Pinjaman)\s+bank\b/i] },
  { code: "DEBT_NONCURRENT_NONBANK", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/LIABILITAS\s+JANGKA\s+PANJANG[\s\S]{0,900}?Pinjaman\s+dari\s+instansi\s+keuangan\s+non[- ]bank/i] },
  { code: "DEBT_NONCURRENT_RUPIAH_BONDS", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/LIABILITAS\s+JANGKA\s+PANJANG[\s\S]{0,1100}?(?:Utang\s+obligasi|Obligasi\s+Rupiah)/i] },
  { code: "DEBT_NONCURRENT_USD_BONDS", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/LIABILITAS\s+JANGKA\s+PANJANG[\s\S]{0,1300}?Obligasi\s+Dolar\s+AS/i] },
  { code: "DEBT_NONCURRENT_OTHER_LONG", statements: ["BALANCE_SHEET"], minAbs: "1000", requirePrimary: true, aliases: [/LIABILITAS\s+JANGKA\s+PANJANG[\s\S]{0,1000}?Utang\s+jangka\s+panjang\s+lainnya/i] },
];

const SHARES_SUBSTITUTE = /weighted\s+average\s+(?:number\s+of\s+)?(?:ordinary\s+)?shares?|rata[- ]rata\s+tertimbang(?:\s+jumlah)?\s+saham|treasury\s+(?:shares?|stock)|saham\s+treasuri|issued\s+(?:and\s+fully\s+paid\s+)?shares?|saham\s+(?:yang\s+)?(?:telah\s+)?diterbitkan|shares?\s+buyback|pembelian\s+kembali\s+saham/i;
const OCI_COMPONENT = /translation\s+adjustment|selisih\s+kurs\s+karena\s+penjabaran|cash\s+flow\s+hedg|instrumen\s+lindung\s+nilai\s+arus\s+kas|share\s+of\s+other\s+comprehensive|bagian\s+rugi\s+komprehensif\s+lain/i;

function scope(page: P0ARoutedPage, context: P0AIssuerContext): "CONSOLIDATED" | "STANDALONE" | "UNKNOWN" {
  if (/\b(?:separate statement|separate financial statements?|separate financial information|laporan[^\n]{0,80}tersendiri|informasi keuangan entitas induk|entitas induk saja|parent entity financial information|parent company only)\b/i.test(page.text)) return "STANDALONE";
  if (/\b(?:consolidated|konsolidasian)\b/i.test(page.text)) return "CONSOLIDATED";
  return context.consolidated === true ? "CONSOLIDATED" : context.consolidated === false ? "STANDALONE" : "UNKNOWN";
}

function eligiblePage(page: P0ARoutedPage, context: P0AIssuerContext, spec: ReportedSpec): boolean {
  if (!spec.statements.includes(page.statementType)) return false;
  if (spec.requirePrimary && !page.pageClass.startsWith("PRIMARY_")) return false;
  if (context.consolidated === true && scope(page, context) === "STANDALONE") return false;
  if (page.pageClass === "TABLE_OF_CONTENTS" || page.pageClass === "AUDITOR_REPORT") return false;
  return true;
}

function extractSpec(pages: readonly P0ARoutedPage[], context: P0AIssuerContext, spec: ReportedSpec): Phase6AInput | null {
  const candidates: Array<{ input: Phase6AInput; score: number }> = [];
  for (const page of pages) {
    if (!eligiblePage(page, context, spec)) continue;
    for (const pattern of spec.aliases) {
      const regex = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
      for (const match of page.text.matchAll(regex)) {
        if (match.index === undefined) continue;
        const windowStart = Math.max(0, match.index - 80);
        const afterStart = match.index + match[0].length;
        const windowEnd = Math.min(page.text.length, afterStart + 240);
        const local = page.text.slice(windowStart, windowEnd);
        if (spec.reject?.test(local)) continue;
        const after = page.text.slice(afterStart, windowEnd);
        NUMBER.lastIndex = 0;
        for (const number of after.matchAll(NUMBER)) {
          if (number.index === undefined) continue;
          const parsed = parseFinancialDecimal(number[0]);
          if (!parsed || new Prisma.Decimal(parsed.decimal).abs().lessThan(spec.minAbs)) continue;
          const snippet = page.text.slice(windowStart, windowEnd);
          const evidence = createEvidence({ requirementId: spec.code, page, statement: page.statementType, rowLabel: match[0].replace(/\s+/g, " ").trim(), columnLabel: context.periodEnd, rawValue: number[0], snippet });
          const value = parsed.decimal;
          const inputId = `fact:${sha([context.ticker, spec.code, context.periodEnd, scope(page, context), value, evidence.evidenceHash].join("|"))}`;
          candidates.push({
            input: { inputId, inputRole: spec.code, requirementId: spec.code, value, currency: spec.code === "SHARES_OUTSTANDING_REPORTED" ? "SHARES" : context.currency, scale: spec.code === "SHARES_OUTSTANDING_REPORTED" ? "1" : context.documentScale, periodStart: context.periodStart, periodEnd: context.periodEnd, scope: scope(page, context), extractionOrigin: page.sourceType ?? "NATIVE", evidence: [evidence] },
            score: (page.pageClass.startsWith("PRIMARY_") ? 100 : page.pageClass === "TARGETED_NOTE" ? 50 : 0) - page.pageNumber / 10_000 - number.index / 100_000,
          });
          break;
        }
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.input ?? null;
}

/**
 * A statement of changes in equity can report an OCI row and its consolidated
 * total even when the profit-or-loss statement only lists OCI components. The
 * last numeric cell before the next comprehensive-income row is the explicit
 * Total Equity column, not an InvestAI sum. This is a requirement/statement
 * rule: no issuer, page number, or expected value participates in selection.
 */
function extractChangesInEquityOciTotal(pages: readonly P0ARoutedPage[], context: P0AIssuerContext): Phase6AInput | null {
  const candidates: Array<{ input: Phase6AInput; score: number }> = [];
  for (const page of pages) {
    if (page.statementType !== "CHANGES_IN_EQUITY" || !page.pageClass.startsWith("PRIMARY_") || (context.consolidated === true && scope(page, context) === "STANDALONE")) continue;
    const rowPattern = /(?:penghasilan\s+komprehensif\s+lain|other\s+comprehensive\s+income)/ig;
    for (const match of page.text.matchAll(rowPattern)) {
      if (match.index === undefined) continue;
      const afterStart = match.index + match[0].length;
      const remainder = page.text.slice(afterStart);
      const nextRow = remainder.search(/(?:jumlah\s+laba\s+komprehensif|total\s+comprehensive\s+income)/i);
      if (nextRow < 0) continue;
      const row = remainder.slice(0, nextRow);
      NUMBER.lastIndex = 0;
      const parsed: Array<{ raw: string; decimal: string }> = [];
      for (const number of row.matchAll(NUMBER)) {
        const value = parseFinancialDecimal(number[0]);
        if (value && new Prisma.Decimal(value.decimal).abs().greaterThanOrEqualTo("10000")) parsed.push({ raw: number[0], decimal: value.decimal });
      }
      const total = parsed.at(-1);
      if (!total) continue;
      const rowStart = Math.max(0, match.index - 80);
      const snippet = page.text.slice(rowStart, Math.min(page.text.length, afterStart + nextRow));
      const evidence = createEvidence({ requirementId: "OCI_TOTAL_REPORTED", page, statement: page.statementType, rowLabel: match[0].replace(/\s+/g, " ").trim(), columnLabel: "Jumlah Ekuitas / Total Equity", rawValue: total.raw, snippet });
      const value = total.decimal;
      const inputId = `fact:${sha([context.ticker, "OCI_TOTAL_REPORTED", context.periodEnd, scope(page, context), value, evidence.evidenceHash].join("|"))}`;
      const balanceYears = [...page.text.matchAll(/(?:saldo\s+tanggal|balance,?)[\s\S]{0,60}?(\d{4})/ig)].map((candidate) => candidate[1]);
      const closesOnContextYear = balanceYears.at(-1) === context.periodEnd.slice(0, 4);
      candidates.push({
        input: { inputId, inputRole: "OCI_TOTAL_REPORTED", requirementId: "OCI_TOTAL_REPORTED", value, currency: context.currency, scale: context.documentScale, periodStart: context.periodStart, periodEnd: context.periodEnd, scope: scope(page, context), extractionOrigin: page.sourceType ?? "NATIVE", evidence: [evidence] },
        score: (closesOnContextYear ? 1_000 : 0) + page.pageNumber / 10_000,
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.input ?? null;
}

function exhaustiveAbsenceReason(requirement: Phase6ARequirement, pages: readonly P0ARoutedPage[], context: P0AIssuerContext): string | null {
  const compatiblePages = pages.filter((page) => !(context.consolidated === true && scope(page, context) === "STANDALONE"));
  if (requirement.canonicalCode === "SHARES_OUTSTANDING_REPORTED") {
    const substitutePages = compatiblePages.filter((page) => SHARES_SUBSTITUTE.test(page.text)).map((page) => page.pageNumber);
    if (substitutePages.length) return `TRUE_NOT_DISCLOSED: exhaustive deterministic full-document review found only prohibited issued, treasury, weighted-average, or buyback substitutes on candidate pages ${[...new Set(substitutePages)].join(", ")}; no exact issuer-reported period-end outstanding-shares scalar exists.`;
  }
  if (requirement.canonicalCode === "OCI_TOTAL_REPORTED") {
    const componentPages = compatiblePages.filter((page) => OCI_COMPONENT.test(page.text)).map((page) => page.pageNumber);
    if (componentPages.length) return `TRUE_NOT_DISCLOSED: exhaustive deterministic review found OCI components but no explicit reported OCI total on candidate pages ${[...new Set(componentPages)].join(", ")}; components were not summed or relabeled as REPORTED.`;
  }
  return null;
}

function p0aInput(p0a: P0ACompatiblePipelineResult, requirementId: string, role = requirementId): Phase6AInput | null {
  const observation = p0a.outcomes.find((item) => item.requirementId === requirementId)?.reportedObservation;
  if (!observation || !observation.decimalValue || !["VALUE", "ZERO"].includes(observation.state)) return null;
  const page = p0a.routedPages.find((item) => item.pageNumber === observation.evidence[0]?.pageNumber);
  const periodNature = requirementId === "OCF_REPORTED" ? "DURATION" : "INSTANT";
  return {
    inputId: `fact:${sha([p0a.contextHash, requirementId, observation.decimalValue, observation.evidence.map((item) => item.evidenceHash).join(",")].join("|"))}`,
    inputRole: role,
    requirementId,
    value: observation.decimalValue,
    currency: observation.currency,
    scale: observation.scale,
    periodStart: periodNature === "DURATION" ? "" : "",
    periodEnd: "",
    scope: page ? scope(page, { ticker: "", issuerType: "OTHER", accountingModel: "OTHER_FINANCIAL", consolidated: null, audited: null, periodStart: "", periodEnd: "", periodType: "FY", currency: "", documentScale: "1" }) : "UNKNOWN",
    extractionOrigin: page?.sourceType ?? "NATIVE",
    evidence: observation.evidence,
  };
}

function normalizedInput(input: Phase6AInput, context: P0AIssuerContext): Phase6AInput {
  return { ...input, periodStart: context.periodStart, periodEnd: context.periodEnd, scope: context.consolidated === true ? "CONSOLIDATED" : context.consolidated === false ? "STANDALONE" : input.scope };
}

function compatible(inputs: readonly Phase6AInput[]): boolean {
  if (!inputs.length) return false;
  const first = inputs[0];
  return inputs.every((item) => item.currency === first.currency && item.scale === first.scale && item.periodStart === first.periodStart && item.periodEnd === first.periodEnd && item.scope === first.scope);
}

function reportedOutcome(requirement: Phase6ARequirement, input: Phase6AInput | null, context: P0AIssuerContext, pages: readonly P0ARoutedPage[]): Phase6AOutcome {
  const requiredMissing = requirement.applicability === "EXPECTED";
  const absenceReason = input ? null : exhaustiveAbsenceReason(requirement, pages, context);
  if (!input) return { requirementId: requirement.requirementId, canonicalCode: requirement.canonicalCode, family: "REPORTED", applicability: requirement.applicability, state: absenceReason || !requiredMissing ? "NOT_DISCLOSED" : "MISSING", value: null, rawValue: null, currency: null, unitType: requirement.unitType, scale: null, period: { start: context.periodStart, end: context.periodEnd, type: context.periodType }, scope: context.consolidated === true ? "CONSOLIDATED" : context.consolidated === false ? "STANDALONE" : "UNKNOWN", evidence: [], extractionOrigin: null, confidence: { read: null, mapping: null }, formula: null, inputs: [], reason: absenceReason ?? (requiredMissing ? "Applicable expected fact was not resolved after deterministic primary/note search." : "No explicit issuer-reported scalar was found; absence is not zero."), factIdentity: null };
  const sourcePage = pages.find((page) => page.pageNumber === input.evidence[0]?.pageNumber);
  return { requirementId: requirement.requirementId, canonicalCode: requirement.canonicalCode, family: "REPORTED", applicability: requirement.applicability, state: new Prisma.Decimal(input.value).isZero() ? "ZERO" : "VALUE", value: input.value, rawValue: input.evidence[0]?.rawValue ?? input.value, currency: input.currency, unitType: requirement.unitType, scale: input.scale, period: { start: context.periodStart, end: context.periodEnd, type: context.periodType }, scope: input.scope, evidence: input.evidence, extractionOrigin: sourcePage?.sourceType ?? "NATIVE", confidence: { read: sourcePage?.sourceType === "OCR" ? sourcePage.sourceMetadata?.numericMeanConfidence ?? null : 1, mapping: 0.995 }, formula: null, inputs: [], reason: "Explicit issuer-reported scalar with source evidence.", factIdentity: input.inputId };
}

function calculatedOutcome(requirement: Phase6ARequirement, inputs: Phase6AInput[], context: P0AIssuerContext, runIdentity: string): Phase6AOutcome {
  const formula = PHASE6A_FORMULA_BY_CODE.get(requirement.canonicalCode);
  const base = { requirementId: requirement.requirementId, canonicalCode: requirement.canonicalCode, family: "CALCULATED" as const, applicability: requirement.applicability, currency: inputs[0]?.currency ?? context.currency, unitType: requirement.unitType, scale: inputs[0]?.scale ?? context.documentScale, period: { start: context.periodStart, end: context.periodEnd, type: context.periodType }, scope: context.consolidated === true ? "CONSOLIDATED" as const : context.consolidated === false ? "STANDALONE" as const : "UNKNOWN" as const, evidence: inputs.flatMap((item) => item.evidence), extractionOrigin: null, confidence: { read: null, mapping: null }, inputs };
  if (!formula) return { ...base, state: "NOT_CALCULABLE", value: null, rawValue: null, formula: null, reason: "CONTRACT_FORMULA_UNDEFINED: Canonical Data Contract v1.0 FINAL does not define an unambiguous calculation formula.", factIdentity: null };
  if (!inputs.length) return { ...base, state: "INPUT_MISSING", value: null, rawValue: null, formula: { formulaId: formula.formulaId, formulaVersion: formula.formulaVersion, expression: formula.expression, calculationRunIdentity: runIdentity, resultHash: "" }, reason: "No accepted input facts satisfy the formula.", factIdentity: null };
  const flexibleInputs = requirement.canonicalCode === "CAPEX_TOTAL_CASH_CALCULATED" || requirement.canonicalCode === "TOTAL_DEBT_CALCULATED";
  if (requirement.canonicalCode === "TOTAL_DEBT_CALCULATED") {
    const roles = new Set(inputs.map((item) => item.inputRole));
    const hasShortTerm = [...roles].some((role) => role.startsWith("SHORT_TERM_") || role.startsWith("CURRENT_MATURITY_"));
    const hasLongTerm = [...roles].some((role) => role.startsWith("LONG_TERM_"));
    if (!hasShortTerm || !hasLongTerm || !roles.has("LEASE_LIABILITIES_TOTAL")) return { ...base, state: "INPUT_MISSING", value: null, rawValue: null, formula: { formulaId: formula.formulaId, formulaVersion: formula.formulaVersion, expression: formula.expression, calculationRunIdentity: runIdentity, resultHash: "" }, reason: "Debt calculation requires accepted short-term/current-maturity debt, long-term debt, and lease-liability inputs; no partial calculation was emitted.", factIdentity: null };
  }
  if (!flexibleInputs && formula.inputRoles.some((role) => !inputs.some((item) => item.inputRole === role))) return { ...base, state: "INPUT_MISSING", value: null, rawValue: null, formula: { formulaId: formula.formulaId, formulaVersion: formula.formulaVersion, expression: formula.expression, calculationRunIdentity: runIdentity, resultHash: "" }, reason: "One or more contract-required input roles are missing; no partial calculation was emitted.", factIdentity: null };
  if (!compatible(inputs)) return { ...base, state: "INPUT_SCOPE_CONFLICT", value: null, rawValue: null, formula: { formulaId: formula.formulaId, formulaVersion: formula.formulaVersion, expression: formula.expression, calculationRunIdentity: runIdentity, resultHash: "" }, reason: "Inputs differ in period, scope, currency, or scale; calculation failed closed.", factIdentity: null };
  const value = inputs.reduce((sum, item) => sum.plus(item.value), new Prisma.Decimal(0)).toFixed();
  const resultHash = sha(JSON.stringify({ code: formula.code, version: formula.formulaVersion, inputs: inputs.map(({ inputId, inputRole, value: inputValue }) => ({ inputId, inputRole, inputValue })), value, context }));
  return { ...base, state: new Prisma.Decimal(value).isZero() ? "ZERO" : "VALUE", value, rawValue: null, formula: { formulaId: formula.formulaId, formulaVersion: formula.formulaVersion, expression: formula.expression, calculationRunIdentity: runIdentity, resultHash }, reason: "Deterministic Decimal calculation from exact accepted input identities.", factIdentity: `result:${resultHash}` };
}

function outcomeInput(outcome: Phase6AOutcome, role: string, context: P0AIssuerContext): Phase6AInput | null {
  if (!outcome.value || !outcome.factIdentity || !["VALUE", "ZERO"].includes(outcome.state) || !outcome.currency || !outcome.scale) return null;
  return { inputId: outcome.factIdentity, inputRole: role, requirementId: outcome.requirementId, value: outcome.value, currency: outcome.currency, scale: outcome.scale, periodStart: context.periodStart, periodEnd: context.periodEnd, scope: outcome.scope, extractionOrigin: outcome.extractionOrigin, evidence: outcome.evidence };
}

export async function runPhase6A(input: { bytes: Buffer; context: P0AIssuerContext; p0aResult?: P0ACompatiblePipelineResult }): Promise<Phase6AResult> {
  const p0a = input.p0aResult ?? await runP0ACompatiblePipeline({ bytes: input.bytes, context: input.context });
  const documentSha256 = sha(input.bytes);
  const runIdentity = sha(JSON.stringify({ documentSha256, context: input.context, manifest: PHASE6A_MANIFEST_VERSION, extractor: PHASE6A_EXTRACTOR_VERSION, formulas: PHASE6A_FORMULA_REGISTRY_VERSION }));
  const extracted = new Map<string, Phase6AInput>();
  for (const spec of [...REPORTED_SPECS, ...COMPONENT_SPECS]) {
    const found = extractSpec(p0a.routedPages, input.context, spec);
    if (found) extracted.set(spec.code, normalizedInput(found, input.context));
  }
  if (!extracted.has("OCI_TOTAL_REPORTED")) {
    const equityOci = extractChangesInEquityOciTotal(p0a.routedPages, input.context);
    if (equityOci) extracted.set("OCI_TOTAL_REPORTED", normalizedInput(equityOci, input.context));
  }

  const byCode = new Map<string, Phase6AOutcome>();
  for (const requirement of PHASE6A_REQUIREMENTS.filter((item) => item.family === "REPORTED")) {
    byCode.set(requirement.canonicalCode, reportedOutcome(requirement, extracted.get(requirement.canonicalCode) ?? null, input.context, p0a.routedPages));
  }
  const req = (code: string) => PHASE6A_REQUIREMENTS.find((item) => item.canonicalCode === code)!;
  const normalizedP0A = (id: string, role: string) => { const found = p0aInput(p0a, id, role); return found ? normalizedInput(found, input.context) : null; };
  const present = <T>(values: Array<T | null | undefined>): T[] => values.filter((item): item is T => item !== null && item !== undefined);

  const lease = calculatedOutcome(req("LEASE_LIABILITIES_CALCULATED"), present([
    extracted.get("LEASE_CURRENT_COMPONENT") ? { ...extracted.get("LEASE_CURRENT_COMPONENT")!, inputRole: "LEASE_CURRENT" } : null,
    extracted.get("LEASE_NONCURRENT_COMPONENT") ? { ...extracted.get("LEASE_NONCURRENT_COMPONENT")!, inputRole: "LEASE_NONCURRENT" } : null,
  ]), input.context, runIdentity);
  byCode.set(lease.canonicalCode, lease);

  const leaseInput = outcomeInput(byCode.get("LEASE_LIABILITIES_REPORTED")!, "LEASE_LIABILITIES_TOTAL", input.context) ?? outcomeInput(lease, "LEASE_LIABILITIES_TOTAL", input.context);
  const debt = calculatedOutcome(req("TOTAL_DEBT_CALCULATED"), present([
    extracted.get("DEBT_SHORT_BANK_DIRECT") ? { ...extracted.get("DEBT_SHORT_BANK_DIRECT")!, inputRole: "SHORT_TERM_BANK_DEBT" } : null,
    extracted.get("DEBT_CURRENT_MATURITY_BANK") ? { ...extracted.get("DEBT_CURRENT_MATURITY_BANK")!, inputRole: "CURRENT_MATURITY_BANK_DEBT" } : null,
    extracted.get("DEBT_CURRENT_MATURITY_NONBANK") ? { ...extracted.get("DEBT_CURRENT_MATURITY_NONBANK")!, inputRole: "CURRENT_MATURITY_NONBANK_DEBT" } : null,
    extracted.get("DEBT_CURRENT_MATURITY_RUPIAH_BONDS") ? { ...extracted.get("DEBT_CURRENT_MATURITY_RUPIAH_BONDS")!, inputRole: "CURRENT_MATURITY_BONDS" } : null,
    extracted.get("DEBT_NONCURRENT_BANK") ? { ...extracted.get("DEBT_NONCURRENT_BANK")!, inputRole: "LONG_TERM_BANK_DEBT" } : null,
    extracted.get("DEBT_NONCURRENT_NONBANK") ? { ...extracted.get("DEBT_NONCURRENT_NONBANK")!, inputRole: "LONG_TERM_NONBANK_DEBT" } : null,
    extracted.get("DEBT_NONCURRENT_RUPIAH_BONDS") ? { ...extracted.get("DEBT_NONCURRENT_RUPIAH_BONDS")!, inputRole: "LONG_TERM_RUPIAH_BONDS" } : null,
    extracted.get("DEBT_NONCURRENT_USD_BONDS") ? { ...extracted.get("DEBT_NONCURRENT_USD_BONDS")!, inputRole: "LONG_TERM_USD_BONDS" } : null,
    extracted.get("DEBT_NONCURRENT_OTHER_LONG") ? { ...extracted.get("DEBT_NONCURRENT_OTHER_LONG")!, inputRole: "LONG_TERM_OTHER_INTEREST_BEARING_DEBT" } : null,
    leaseInput,
  ]), input.context, runIdentity);
  byCode.set(debt.canonicalCode, debt);

  const sga = calculatedOutcome(req("SGA_CALCULATED"), present([
    extracted.get("SELLING_DISTRIBUTION_COMPONENT") ? { ...extracted.get("SELLING_DISTRIBUTION_COMPONENT")!, inputRole: "SELLING_DISTRIBUTION_EXPENSE" } : null,
    extracted.get("GENERAL_ADMIN_COMPONENT") ? { ...extracted.get("GENERAL_ADMIN_COMPONENT")!, inputRole: "GENERAL_ADMINISTRATIVE_EXPENSE" } : null,
  ]), input.context, runIdentity);
  byCode.set(sga.canonicalCode, sga);
  byCode.set("EBITDA_CALCULATED", calculatedOutcome(req("EBITDA_CALCULATED"), [], input.context, runIdentity));

  const capexInputs = present([
    outcomeInput(byCode.get("CAPEX_PPE_CASH_REPORTED")!, "CAPEX_PPE_CASH", input.context),
    outcomeInput(byCode.get("CAPEX_INTANGIBLE_CASH_REPORTED")!, "CAPEX_INTANGIBLE_CASH", input.context),
    extracted.get("CAPEX_PPE_ADVANCE_COMPONENT") ? { ...extracted.get("CAPEX_PPE_ADVANCE_COMPONENT")!, inputRole: "CAPEX_PPE_ADVANCE_CASH" } : null,
    extracted.get("CAPEX_EXPLORATION_COMPONENT") ? { ...extracted.get("CAPEX_EXPLORATION_COMPONENT")!, inputRole: "CAPEX_EXPLORATION_EVALUATION_CASH" } : null,
    extracted.get("CAPEX_CONCESSION_COMPONENT") ? { ...extracted.get("CAPEX_CONCESSION_COMPONENT")!, inputRole: "CAPEX_CONCESSION_CASH" } : null,
    extracted.get("CAPEX_OIL_GAS_COMPONENT") ? { ...extracted.get("CAPEX_OIL_GAS_COMPONENT")!, inputRole: "CAPEX_OIL_GAS_PROPERTY_CASH" } : null,
  ]);
  const capex = calculatedOutcome(req("CAPEX_TOTAL_CASH_CALCULATED"), capexInputs, input.context, runIdentity);
  byCode.set(capex.canonicalCode, capex);

  const selectedCapex = outcomeInput(byCode.get("CAPEX_TOTAL_CASH_REPORTED")!, "SIGNED_CAPEX_TOTAL_CASH", input.context) ?? outcomeInput(capex, "SIGNED_CAPEX_TOTAL_CASH", input.context);
  const ocf = extracted.get("OCF_COMPONENT") ? { ...extracted.get("OCF_COMPONENT")!, inputRole: "OCF_REPORTED" } : normalizedP0A("OCF_REPORTED", "OCF_REPORTED");
  const fcf = calculatedOutcome(req("FCF_CALCULATED"), present([ocf, selectedCapex]), input.context, runIdentity);
  byCode.set(fcf.canonicalCode, fcf);

  const outcomes = PHASE6A_REQUIREMENTS.map((item) => byCode.get(item.canonicalCode)!);
  const numeric = (code: string) => { const value = byCode.get(code)?.value; return value === null || value === undefined ? null : new Prisma.Decimal(value); };
  const net = p0a.outcomes.find((item) => item.requirementId === "NET_PROFIT_REPORTED")?.reportedObservation?.decimalValue;
  const oci = numeric("OCI_TOTAL_REPORTED");
  const comprehensive = numeric("TOTAL_COMPREHENSIVE_INCOME_REPORTED");
  const controls = [
    { controlId: "COMPREHENSIVE_INCOME_BRIDGE", applicable: Boolean(net && oci && comprehensive), passed: net && oci && comprehensive ? new Prisma.Decimal(net).plus(oci).equals(comprehensive) : null, reason: "NET_PROFIT_REPORTED + OCI_TOTAL_REPORTED compared with TOTAL_COMPREHENSIVE_INCOME_REPORTED only at matching scope." },
    ...["LEASE_LIABILITIES_CALCULATED", "TOTAL_DEBT_CALCULATED", "SGA_CALCULATED", "CAPEX_TOTAL_CASH_CALCULATED", "FCF_CALCULATED"].map((code) => { const item = byCode.get(code)!; return { controlId: `${code}_REPRODUCIBILITY`, applicable: ["VALUE", "ZERO"].includes(item.state), passed: ["VALUE", "ZERO"].includes(item.state) ? item.inputs.reduce((sum, value) => sum.plus(value.value), new Prisma.Decimal(0)).equals(item.value!) : null, reason: "Stored result must equal Decimal sum of the exact stored inputs." }; }),
  ];
  const p0aFingerprint = sha(JSON.stringify(p0a.outcomes.map((item) => ({ requirementId: item.requirementId, state: item.state, value: item.reportedObservation?.decimalValue ?? null, evidence: item.reportedObservation?.evidence.map((e) => e.evidenceHash) ?? [] }))));
  return {
    manifestVersion: PHASE6A_MANIFEST_VERSION, extractorVersion: PHASE6A_EXTRACTOR_VERSION, formulaRegistryVersion: PHASE6A_FORMULA_REGISTRY_VERSION,
    context: input.context, documentSha256,
    p0a: { selectedPages: p0a.selectedPages, outcomeFingerprint: p0aFingerprint, providerCalls: p0a.usage.providerCalls, ocrPages: p0a.ocrUsage.ocrPages, reusedOcrPages: p0a.ocrUsage.reusedOcrPages, versions: p0a.versions },
    selectedPages: [...new Set(outcomes.flatMap((item) => item.evidence.map((e) => e.pageNumber)))].sort((a, b) => a - b),
    outcomes, controls, providerUsage: { providerCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: "0.00000000" }, runIdentity,
  };
}
