import { createEvidence } from "@/lib/financial/p0a/evidence";
import type { P0AIndexedPage, P0AObservation, P0APlanTask } from "@/lib/financial/p0a/types";

export type P0AExtractor = (task: P0APlanTask, pages: readonly P0AIndexedPage[]) => Promise<P0AObservation[]>;

export type IcbpGoldFixtureFact = {
  code: string;
  page: number;
  value: string | null;
  raw: string;
  row: string;
  anchor: string;
  unit?: P0AObservation["unitType"];
  scale?: string;
  origin?: P0AObservation["origin"];
  state?: P0AObservation["state"];
};

export const ICBP_GOLD_DIRECT_FACTS: readonly IcbpGoldFixtureFact[] = [
  { code: "CASH", page: 4, value: "27296335", raw: "27.296.335", row: "Cash and cash equivalents", anchor: "27.296.335" },
  { code: "INV", page: 4, value: "6873859", raw: "6.873.859", row: "Inventories - net", anchor: "6.873.859" },
  { code: "CURRENT_ASSETS", page: 4, value: "49238213", raw: "49.238.213", row: "Total Current Assets", anchor: "49.238.213" },
  { code: "PPE", page: 4, value: "15934426", raw: "15.934.426", row: "Fixed assets - net", anchor: "15.934.426" },
  { code: "TOTAL_ASSETS", page: 4, value: "131995676", raw: "131.995.676", row: "TOTAL ASSETS", anchor: "131.995.676" },
  { code: "CURRENT_LIAB", page: 5, value: "14444778", raw: "14.444.778", row: "Total Current Liabilities", anchor: "14.444.778" },
  { code: "TOTAL_LIAB", page: 5, value: "62495900", raw: "62.495.900", row: "TOTAL LIABILITIES", anchor: "62.495.900" },
  { code: "EQUITY", page: 6, value: "69499776", raw: "69.499.776", row: "TOTAL EQUITY", anchor: "69.499.776" },
  { code: "EQUITY_PARENT", page: 6, value: "47532078", raw: "47.532.078", row: "Equity Attributable to Equity Holders of the Parent Entity", anchor: "47.532.0 78" },
  { code: "NCI", page: 6, value: "21967698", raw: "21.967.698", row: "Non-controlling Interests", anchor: "21.967.698" },
  { code: "REV", page: 7, value: "37600928", raw: "37.600.928", row: "NET SALES", anchor: "37.600.928" },
  { code: "COGS", page: 7, value: "24478388", raw: "24.478.388", row: "COST OF GOODS SOLD", anchor: "24.478.388" },
  { code: "GROSS_PROFIT", page: 7, value: "13122540", raw: "13.122.540", row: "GROSS PROFIT", anchor: "13.122.540" },
  { code: "OPERATING_PROFIT", page: 7, value: "8475878", raw: "8.475.878", row: "INCOME FROM OPERATIONS", anchor: "8.475.878" },
  { code: "FINANCE_INCOME", page: 7, value: "486751", raw: "486.751", row: "Finance income", anchor: "486.751" },
  { code: "FINANCE_COST", page: 7, value: "-1294976", raw: "(1.294.976)", row: "Finance expenses", anchor: "1.294.976" },
  { code: "PRETAX_PROFIT", page: 7, value: "7742091", raw: "7.742.091", row: "INCOME BEFORE INCOME TAX EXPENSE", anchor: "7.742.091" },
  { code: "TAX_EXPENSE", page: 7, value: "-1536498", raw: "(1.536.498)", row: "Income tax expense", anchor: "1.536.498" },
  { code: "NET_PROFIT", page: 7, value: "6205593", raw: "6.205.593", row: "INCOME FOR THE PERIOD", anchor: "6.205.593" },
  { code: "NET_PROFIT_PARENT", page: 8, value: "5536138", raw: "5.536.138", row: "Equity holders of the parent entity", anchor: "5.536.138" },
  { code: "EPS_BASIC", page: 8, value: "475", raw: "475", row: "BASIC EARNINGS PER SHARE", anchor: "475 303", unit: "PER_SHARE", scale: "1" },
  { code: "OCF", page: 10, value: "4844057", raw: "4.844.057", row: "Net Cash Provided by Operating Activities", anchor: "4.844.057" },
  { code: "ICF", page: 10, value: "-2423915", raw: "(2.423.915)", row: "Net Cash Used in Investing Activities", anchor: "2.423.915" },
  { code: "CFF", page: 10, value: "-755944", raw: "(755.944)", row: "Net Cash Used in Financing Activities", anchor: "755.944" },
  { code: "FX_EFFECT_CASH", page: 10, value: "339497", raw: "339.497", row: "Net effect of changes in exchange rates", anchor: "339.497" },
  { code: "NET_CHANGE_CASH", page: 10, value: "2003695", raw: "2.003.695", row: "Net increase in cash and cash equivalents", anchor: "2.003.695" },
  { code: "SHARES_ISSUED", page: 86, value: "11661908000", raw: "11.661.908.000", row: "Total Shares Issued and Fully Paid", anchor: "11.661.908.000", unit: "SHARES", scale: "1" },
  { code: "WEIGHTED_AVG_SHARES", page: 88, value: "11661908000", raw: "11 . 661 . 908 . 000", row: "Weighted average number of shares", anchor: "11 . 661 . 908 . 000", unit: "SHARES", scale: "1" },
  { code: "EPS_DILUTED", page: 88, value: null, raw: "not calculated and presented", row: "Diluted earnings per share", anchor: "diluted earnings per share are calculated and", unit: "PER_SHARE", scale: "1", state: "NOT_APPLICABLE" },
];

export const ICBP_GOLD_CALCULATED_ALTERNATIVES: ReadonlyArray<IcbpGoldFixtureFact & { components: string[] }> = [
  { code: "AR", page: 4, value: "10720256", raw: "4.966.484 + 5.753.772", row: "Trade accounts receivable", anchor: "4.966.484", origin: "STANDARDIZED_AGGREGATE", components: ["4.966.484", "5.753.772"] },
  { code: "AP", page: 5, value: "4353532", raw: "3.978.473 + 375.059", row: "Trade accounts payable", anchor: "3.978.473", origin: "STANDARDIZED_AGGREGATE", components: ["3.978.473", "375.059"] },
  { code: "SHORT_TERM_DEBT", page: 5, value: "621216", raw: "287.819 + 333.397", row: "Short-term debt aggregate", anchor: "287.819", origin: "STANDARDIZED_AGGREGATE", components: ["287.819", "333.397"] },
  { code: "LONG_TERM_DEBT", page: 5, value: "44919281", raw: "494.121 + 44.416.407 + 8.753", row: "Long-term debt aggregate", anchor: "494.121", origin: "STANDARDIZED_AGGREGATE", components: ["494.121", "44.416.407", "8.753"] },
];

function snippet(text: string, anchor: string): string {
  const at = text.indexOf(anchor);
  if (at < 0) throw new Error(`ICBP deterministic fixture anchor missing: ${anchor}`);
  return text.slice(Math.max(0, at - 100), Math.min(text.length, at + anchor.length + 100));
}

function observation(spec: IcbpGoldFixtureFact, pages: ReadonlyMap<number, P0AIndexedPage>, allAnchors = [spec.anchor]): P0AObservation {
  const page = pages.get(spec.page);
  if (!page) throw new Error(`ICBP deterministic fixture requires selected page ${spec.page}.`);
  const requirementId = `${spec.code}_REPORTED`;
  return {
    requirementId,
    origin: spec.origin ?? "REPORTED",
    state: spec.state ?? "VALUE",
    decimalValue: spec.value,
    rawValue: spec.raw,
    currency: spec.unit === "SHARES" ? "SHARES" : spec.unit === "PER_SHARE" ? "IDR_PER_SHARE" : "IDR",
    unitType: spec.unit ?? "DOCUMENT_CURRENCY",
    scale: spec.scale ?? "1000000",
    evidence: allAnchors.map((anchor) => createEvidence({
      requirementId,
      page,
      statement: spec.page === 10 ? "CASH_FLOW" : spec.page === 7 || spec.page === 8 || spec.page === 88 ? "INCOME_STATEMENT" : "BALANCE_SHEET",
      table: null,
      rowLabel: spec.row,
      columnLabel: "2025",
      rawValue: anchor,
      snippet: snippet(page.text, anchor),
    })),
  };
}

/** Deterministic fixture extractor for the approved ICBP zero-AI acceptance only. */
export function createIcbpDeterministicExtractor(): P0AExtractor {
  return async (task, indexedPages) => {
    const selected = new Map(indexedPages.filter((page) => task.selectedPages.includes(page.pageNumber)).map((page) => [page.pageNumber, page]));
    const required = new Set(task.requirementIds);
    const facts = ICBP_GOLD_DIRECT_FACTS.filter((fact) => required.has(`${fact.code}_REPORTED`) && selected.has(fact.page)).map((fact) => observation(fact, selected));
    const calculated = ICBP_GOLD_CALCULATED_ALTERNATIVES.filter((fact) => required.has(`${fact.code}_REPORTED`) && selected.has(fact.page)).map((fact) => observation(fact, selected, fact.components));
    return [...facts, ...calculated];
  };
}

export const noProviderExtractor: P0AExtractor = async () => [];
