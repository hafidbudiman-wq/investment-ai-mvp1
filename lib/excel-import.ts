import * as XLSX from "xlsx";

export type ExcelRow = {
  reportedAccount: string;
  value: number;
  sheetName: string;
  rowNumber: number;
};

const ACCOUNT_HEADERS = ["account", "account name", "akun", "nama akun", "description", "keterangan"];
const VALUE_HEADERS = ["value", "amount", "nilai", "saldo", "balance"];

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s/g, "").replace(/\(([^)]+)\)/, "-$1").replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseFinancialWorkbook(buffer: ArrayBuffer): ExcelRow[] {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const output: ExcelRow[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
    if (!rows.length) continue;

    let headerIndex = -1;
    let accountIndex = -1;
    let valueIndex = -1;

    for (let r = 0; r < Math.min(rows.length, 30); r += 1) {
      const row = rows[r] as unknown[];
      const normalized = row.map(normalize);
      const a = normalized.findIndex((cell) => ACCOUNT_HEADERS.includes(cell));
      const v = normalized.findIndex((cell) => VALUE_HEADERS.includes(cell));
      if (a >= 0 && v >= 0 && a !== v) {
        headerIndex = r;
        accountIndex = a;
        valueIndex = v;
        break;
      }
    }

    if (headerIndex < 0) continue;

    for (let r = headerIndex + 1; r < rows.length; r += 1) {
      const row = rows[r] as unknown[];
      const reportedAccount = String(row[accountIndex] ?? "").trim();
      const value = toNumber(row[valueIndex]);
      if (!reportedAccount || value === null) continue;
      output.push({ reportedAccount, value, sheetName, rowNumber: r + 1 });
    }
  }

  return output;
}
