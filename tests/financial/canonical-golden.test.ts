import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCanonicalCandidates,
  summarizeCanonicalDecisions,
  type FinancialCandidate,
} from "../../lib/financial/canonical-quality";

type Statement = "BALANCE_SHEET" | "INCOME_STATEMENT" | "CASH_FLOW";

function candidate(label: string, value: number, statementType: Statement, canonicalCode: string | null = null, sourceText = label): FinancialCandidate {
  return {
    statementType,
    reportedLabel: label,
    rawValue: String(value),
    numericValue: value,
    currency: statementType === "BALANCE_SHEET" && /MEDC/i.test(sourceText) ? "USD" : "IDR",
    scale: 1,
    sourcePage: statementType === "BALANCE_SHEET" ? 5 : statementType === "INCOME_STATEMENT" ? 7 : 10,
    sourceText,
    canonicalCode,
    extractionConfidence: 0.99,
    mappingConfidence: canonicalCode ? 0.99 : 0,
  };
}

function acceptedValue(decisions: ReturnType<typeof classifyCanonicalCandidates>, code: string) {
  return decisions.find((decision) => decision.automaticDecision === "ACCEPTED" && decision.canonicalCode === code)?.candidate.numericValue;
}

const drma = [
  candidate("Kas dan setara kas", 592_275_512_729, "BALANCE_SHEET", "CASH"),
  candidate("Piutang usaha — total", 752_733_235_975, "BALANCE_SHEET", "AR"),
  candidate("Persediaan", 524_580_310_093, "BALANCE_SHEET", "INV"),
  candidate("Utang usaha", 651_019_340_258, "BALANCE_SHEET", "AP"),
  candidate("Utang bank jangka pendek", 104_392_088_215, "BALANCE_SHEET"),
  candidate("Bagian utang bank jangka panjang yang akan jatuh tempo dalam satu tahun", 68_557_536_186, "BALANCE_SHEET"),
  candidate("Liabilitas sewa — bagian jangka pendek", 115_720_054, "BALANCE_SHEET"),
  candidate("Utang bank jangka panjang setelah dikurangi bagian yang akan jatuh tempo dalam satu tahun", 105_607_150_517, "BALANCE_SHEET"),
  candidate("Liabilitas sewa — bagian jangka panjang", 11_498_550, "BALANCE_SHEET"),
  candidate("Total debt — aggregate including bank loans and lease liabilities", 278_683_993_522, "BALANCE_SHEET"),
  candidate("Total interest-bearing debt including lease liabilities", 278_683_993_522, "BALANCE_SHEET", "TOTAL_DEBT", "Rule-derived from source components: DRMA debt components"),
  candidate("Penjualan neto", 5_939_676_041_503, "INCOME_STATEMENT", "REV"),
  candidate("Beban pokok penjualan", 4_869_211_295_212, "INCOME_STATEMENT", "COGS"),
  candidate("Laba bruto", 1_070_464_746_291, "INCOME_STATEMENT", "GROSS_PROFIT"),
  candidate("Laba usaha", 843_558_843_036, "INCOME_STATEMENT", "OPERATING_PROFIT"),
  candidate("Laba neto yang dapat diatribusikan kepada pemilik entitas induk", 652_584_272_073, "INCOME_STATEMENT", "NET_PROFIT_PARENT"),
  candidate("Kas neto diperoleh dari aktivitas operasi", 924_029_458_371, "CASH_FLOW", "OCF"),
  candidate("Perolehan aset tetap", -271_215_292_164, "CASH_FLOW"),
  candidate("Capital expenditure — aggregate", -313_970_875_677, "CASH_FLOW"),
  candidate("Penambahan uang muka untuk aset tetap", -42_755_583_513, "CASH_FLOW"),
  candidate("Capital expenditure - productive long-lived asset additions", -313_970_875_677, "CASH_FLOW", "CAPEX", "Rule-derived from source components: DRMA productive assets"),
  candidate("Free cash flow (OCF + negative CAPEX)", 610_058_582_694, "CASH_FLOW", "FCF", "Rule-derived: OCF + CAPEX"),
];

const icbp = [
  candidate("Kas dan setara kas", 27_296_335, "BALANCE_SHEET", "CASH"),
  candidate("Piutang usaha - total neto", 10_720_256, "BALANCE_SHEET", "AR"),
  candidate("Persediaan - neto", 6_873_859, "BALANCE_SHEET", "INV"),
  candidate("Utang usaha - total", 4_353_532, "BALANCE_SHEET", "AP"),
  candidate("Utang bank jangka pendek, cerukan dan utang trust receipts", 287_819, "BALANCE_SHEET"),
  candidate("Utang bank—bagian jatuh tempo dalam satu tahun", 333_397, "BALANCE_SHEET"),
  candidate("Liabilitas sewa—bagian jatuh tempo dalam satu tahun", 123_054, "BALANCE_SHEET"),
  candidate("Utang bank jangka panjang—setelah dikurangi bagian jatuh tempo", 494_121, "BALANCE_SHEET"),
  candidate("Utang obligasi", 44_416_407, "BALANCE_SHEET"),
  candidate("Utang jangka panjang lainnya", 8_753, "BALANCE_SHEET"),
  candidate("Liabilitas sewa—bagian tidak lancar", 155_308, "BALANCE_SHEET"),
  candidate("Total debt—aggregate including lease liabilities", 45_818_859, "BALANCE_SHEET"),
  candidate("Total interest-bearing debt including lease liabilities", 45_818_859, "BALANCE_SHEET", "TOTAL_DEBT", "Rule-derived from source components: ICBP debt components"),
  candidate("PENJUALAN NETO", 37_600_928, "INCOME_STATEMENT", "REV"),
  candidate("BEBAN POKOK PENJUALAN", 24_478_388, "INCOME_STATEMENT", "COGS"),
  candidate("LABA BRUTO", 13_122_540, "INCOME_STATEMENT", "GROSS_PROFIT"),
  candidate("LABA USAHA", 8_475_878, "INCOME_STATEMENT", "OPERATING_PROFIT"),
  candidate("Laba periode berjalan yang dapat diatribusikan kepada pemilik entitas induk", 5_536_138, "INCOME_STATEMENT", "NET_PROFIT_PARENT"),
  candidate("Kas Neto yang Diperoleh dari Aktivitas Operasi", 4_844_057, "CASH_FLOW", "OCF"),
  candidate("Penambahan aset tetap dan uang muka pembelian aset tetap", -2_447_972, "CASH_FLOW", "CAPEX"),
  candidate("CAPEX—aggregate", -2_447_972, "CASH_FLOW", "CAPEX"),
  candidate("Free cash flow (OCF + negative CAPEX)", 2_396_085, "CASH_FLOW", "FCF", "Rule-derived: OCF + CAPEX"),
];

const icbp2026Staging = [
  candidate("Kas dan setara kas", 33_537_992, "BALANCE_SHEET", "CASH"),
  candidate("Piutang usaha - Pihak ketiga - neto", 6_192_895, "BALANCE_SHEET"),
  candidate("Piutang usaha - Pihak berelasi", 5_903_239, "BALANCE_SHEET"),
  candidate("Piutang usaha - Total neto", 12_096_134, "BALANCE_SHEET", "AR"),
  candidate("Persediaan - neto", 7_751_246, "BALANCE_SHEET", "INV"),
  candidate("Utang usaha - Pihak ketiga", 4_928_520, "BALANCE_SHEET"),
  candidate("Utang usaha - Pihak berelasi", 517_755, "BALANCE_SHEET"),
  candidate("Utang usaha - Total", 5_446_275, "BALANCE_SHEET", "AP"),
  candidate("Utang bank jangka pendek, cerukan dan utang trust receipts", 431_154, "BALANCE_SHEET"),
  candidate("Utang bank - jatuh tempo dalam waktu satu tahun", 180_132, "BALANCE_SHEET"),
  candidate("Liabilitas sewa - jatuh tempo dalam waktu satu tahun", 95_237, "BALANCE_SHEET"),
  candidate("Utang bank jangka panjang - setelah dikurangi bagian jatuh tempo", 401_725, "BALANCE_SHEET"),
  candidate("Utang obligasi", 48_900_087, "BALANCE_SHEET"),
  candidate("Utang jangka panjang lainnya", 8_753, "BALANCE_SHEET"),
  candidate("Liabilitas sewa - jangka panjang", 154_603, "BALANCE_SHEET"),
  candidate("Total utang berbunga termasuk liabilitas sewa", 50_171_691, "BALANCE_SHEET"),
  candidate("Total interest-bearing debt including lease liabilities", 50_171_691, "BALANCE_SHEET", "TOTAL_DEBT", "Rule-derived from source components: ICBP 2026 debt"),
  candidate("PENJUALAN NETO", 41_863_388, "INCOME_STATEMENT", "REV"),
  candidate("BEBAN POKOK PENJUALAN", 27_496_156, "INCOME_STATEMENT", "COGS"),
  candidate("LABA BRUTO", 14_367_232, "INCOME_STATEMENT", "GROSS_PROFIT"),
  candidate("LABA USAHA", 9_152_898, "INCOME_STATEMENT", "OPERATING_PROFIT"),
  candidate("Laba periode berjalan yang dapat diatribusikan kepada pemilik entitas induk", 3_702_564, "INCOME_STATEMENT", "NET_PROFIT_PARENT"),
  candidate("Kas Neto yang Diperoleh dari Aktivitas Operasi", 5_672_816, "CASH_FLOW", "OCF"),
  candidate("Penambahan aset tetap dan uang muka pembelian aset tetap", -1_143_431, "CASH_FLOW"),
  candidate("Capital Expenditure - aggregate", -1_143_431, "CASH_FLOW", "CAPEX"),
  candidate("Free cash flow (OCF + negative CAPEX)", 4_529_385, "CASH_FLOW", "FCF", "Rule-derived: OCF + CAPEX"),
];

function medcBalance(period: "H1" | "FY") {
  const h1 = period === "H1";
  const rows = h1 ? [
    candidate("Kas dan setara kas", 824_287_275, "BALANCE_SHEET", "CASH", "MEDC cash"),
    candidate("Piutang usaha — pihak berelasi dan pihak ketiga", 444_881_155, "BALANCE_SHEET", "AR", "MEDC total trade receivable"),
    candidate("Persediaan", 155_743_076, "BALANCE_SHEET", "INV", "MEDC inventories"),
    candidate("Utang usaha — pihak berelasi dan pihak ketiga", 319_412_015, "BALANCE_SHEET", "AP", "MEDC total trade payable"),
  ] : [
    candidate("Kas dan setara kas", 569_106_521, "BALANCE_SHEET", "CASH", "MEDC cash"),
    candidate("Piutang usaha - Pihak berelasi", 23_483, "BALANCE_SHEET", null, "MEDC related trade receivable"),
    candidate("Piutang usaha - Pihak ketiga", 392_919_324, "BALANCE_SHEET", null, "MEDC third party trade receivable"),
    candidate("Jumlah piutang usaha", 392_942_807, "BALANCE_SHEET", "AR", "MEDC total trade receivable"),
    candidate("Persediaan", 144_461_794, "BALANCE_SHEET", "INV", "MEDC inventories"),
    candidate("Utang usaha - Pihak berelasi", 40_654_452, "BALANCE_SHEET", null, "MEDC related trade payable"),
    candidate("Utang usaha - Pihak ketiga", 234_857_701, "BALANCE_SHEET", null, "MEDC third party trade payable"),
    candidate("Jumlah utang usaha", 275_512_153, "BALANCE_SHEET", "AP", "MEDC total trade payable"),
  ];
  const debtValues = h1
    ? [15_000_000, 118_147_525, 2_010_800, 181_932_175, 105_889_581, 1_106_210_750, 102_980_668, 613_959_451, 1_317_278_277, 172_465_481]
    : [2_979_383, 196_398_717, 4_019_024, 48_316_555, 91_563_279, 95_819_308, 1_410_351_161, 100_971_156, 575_633_622, 1_216_079_467, 156_760_446];
  const debtLabels = h1
    ? ["Pinjaman bank jangka pendek", "Pinjaman bank — bagian jangka panjang yang jatuh tempo dalam satu tahun", "Pinjaman dari instansi keuangan non-bank — bagian yang jatuh tempo dalam satu tahun", "Obligasi Rupiah — bagian yang jatuh tempo dalam satu tahun", "Liabilitas sewa — jangka pendek", "Pinjaman bank — jangka panjang setelah dikurangi bagian yang jatuh tempo dalam satu tahun", "Pinjaman dari instansi keuangan non-bank — jangka panjang", "Obligasi Rupiah — jangka panjang", "Obligasi Dolar AS — jangka panjang", "Liabilitas sewa — jangka panjang"]
    : ["Pinjaman bank jangka pendek", "Pinjaman bank - bagian jatuh tempo dalam satu tahun", "Pinjaman dari instansi keuangan non-bank - bagian jatuh tempo dalam satu tahun", "Obligasi Rupiah - bagian jatuh tempo dalam satu tahun", "Obligasi Dolar AS - bagian jatuh tempo dalam satu tahun", "Liabilitas sewa - jangka pendek", "Pinjaman bank - jangka panjang setelah dikurangi bagian lancar", "Pinjaman dari instansi keuangan non-bank - jangka panjang setelah dikurangi bagian lancar", "Obligasi Rupiah - jangka panjang setelah dikurangi bagian lancar", "Obligasi Dolar AS - jangka panjang setelah dikurangi bagian lancar", "Liabilitas sewa - jangka panjang"];
  rows.push(...debtLabels.map((label, index) => candidate(label, debtValues[index], "BALANCE_SHEET", null, `MEDC ${label}`)));
  const total = debtValues.reduce((sum, value) => sum + value, 0);
  rows.push(candidate("Total debt including lease liabilities", total, "BALANCE_SHEET", null, "MEDC aggregate debt"));
  rows.push(candidate("Total interest-bearing debt including lease liabilities", total, "BALANCE_SHEET", "TOTAL_DEBT", "Rule-derived from source components: MEDC debt"));
  return rows;
}

const medcH1 = [
  ...medcBalance("H1"),
  candidate("JUMLAH PENDAPATAN", 1_138_390_027, "INCOME_STATEMENT", "REV"),
  candidate("JUMLAH BEBAN POKOK PENDAPATAN DAN BIAYA LANGSUNG LAINNYA", 702_600_099, "INCOME_STATEMENT", "COGS"),
  candidate("LABA KOTOR", 435_789_928, "INCOME_STATEMENT", "GROSS_PROFIT"),
  candidate("Laba periode berjalan yang diatribusikan kepada pemilik entitas induk", 37_188_257, "INCOME_STATEMENT", "NET_PROFIT_PARENT"),
  candidate("Kas neto diperoleh dari aktivitas operasi", 398_350_369, "CASH_FLOW", "OCF"),
  candidate("Penambahan aset eksplorasi dan evaluasi", -9_662_851, "CASH_FLOW"),
  candidate("Perolehan aset tetap", -6_677_451, "CASH_FLOW"),
  candidate("Penambahan pada aset konsesi", -5_151_556, "CASH_FLOW"),
  candidate("Penambahan aset lain-lain", -35_024_913, "CASH_FLOW"),
  candidate("Penambahan aset minyak dan gas bumi", -163_782_535, "CASH_FLOW"),
  candidate("Total capital expenditure", -220_299_306, "CASH_FLOW"),
  candidate("Capital expenditure - productive long-lived asset additions", -185_274_393, "CASH_FLOW", "CAPEX", "Rule-derived from source components: MEDC productive assets"),
  candidate("Free cash flow (OCF + negative CAPEX)", 213_075_976, "CASH_FLOW", "FCF", "Rule-derived: OCF + CAPEX"),
];

const medcFy = [
  ...medcBalance("FY"),
  candidate("Pendapatan dari kontrak dengan pelanggan", 2_343_476_916, "INCOME_STATEMENT"),
  candidate("Pendapatan keuangan", 51_559_053, "INCOME_STATEMENT"),
  candidate("JUMLAH PENDAPATAN", 2_395_035_969, "INCOME_STATEMENT", "REV"),
  candidate("JUMLAH BEBAN POKOK PENDAPATAN DAN BIAYA LANGSUNG LAINNYA", 1_458_925_049, "INCOME_STATEMENT", "COGS"),
  candidate("LABA KOTOR", 936_110_920, "INCOME_STATEMENT", "GROSS_PROFIT"),
  candidate("Laba tahun berjalan yang diatribusikan kepada pemilik entitas induk", 100_923_998, "INCOME_STATEMENT", "NET_PROFIT_PARENT"),
  candidate("Kas neto diperoleh dari aktivitas operasi", 906_288_170, "CASH_FLOW", "OCF"),
  candidate("Penambahan pada aset konsesi", -3_530_973, "CASH_FLOW"),
  candidate("Penambahan aset eksplorasi dan evaluasi", -68_601_051, "CASH_FLOW"),
  candidate("Perolehan aset tetap", -93_925_421, "CASH_FLOW"),
  candidate("Penambahan aset minyak dan gas bumi", -352_721_301, "CASH_FLOW"),
  candidate("Capital expenditure aggregate", -518_778_746, "CASH_FLOW"),
  candidate("Capital expenditure - productive long-lived asset additions", -518_778_746, "CASH_FLOW", "CAPEX", "Rule-derived from source components: MEDC productive assets"),
  candidate("Free cash flow (OCF + negative CAPEX)", 387_509_424, "CASH_FLOW", "FCF", "Rule-derived: OCF + CAPEX"),
];

const lsip = [
  candidate("Kas dan setara kas", 7_830_497, "BALANCE_SHEET", "CASH"),
  candidate("Piutang usaha, neto", 29_829, "BALANCE_SHEET", "AR"),
  candidate("Persediaan", 570_570, "BALANCE_SHEET", "INV"),
  candidate("Utang usaha", 269_418, "BALANCE_SHEET", "AP"),
  candidate("Bagian lancar atas liabilitas sewa", 166, "BALANCE_SHEET"),
  candidate("Bagian jangka panjang liabilitas sewa", 0, "BALANCE_SHEET"),
  candidate("Total utang berbunga termasuk liabilitas sewa", 166, "BALANCE_SHEET"),
  candidate("Total interest-bearing debt including lease liabilities", 166, "BALANCE_SHEET", "TOTAL_DEBT", "Rule-derived from source components: LSIP leases"),
  candidate("Pendapatan dari kontrak dengan pelanggan", 1_326_929, "INCOME_STATEMENT", "REV"),
  candidate("Beban pokok penjualan", 902_254, "INCOME_STATEMENT", "COGS"),
  candidate("Laba bruto", 424_675, "INCOME_STATEMENT", "GROSS_PROFIT"),
  candidate("Laba usaha", 394_485, "INCOME_STATEMENT", "OPERATING_PROFIT"),
  candidate("Laba periode berjalan yang dapat diatribusikan kepada pemilik entitas induk", 394_437, "INCOME_STATEMENT", "NET_PROFIT_PARENT"),
  candidate("Kas Neto yang Diperoleh dari Aktivitas Operasi", 291_263, "CASH_FLOW", "OCF"),
  candidate("Penambahan aset tetap", -73_431, "CASH_FLOW"),
  candidate("Belanja modal agregat", -73_431, "CASH_FLOW", "CAPEX"),
  candidate("Free cash flow (OCF + negative CAPEX)", 217_832, "CASH_FLOW", "FCF", "Rule-derived: OCF + CAPEX"),
];

for (const fixture of [
  { name: "DRMA FY 2025", candidates: drma, expected: { verifiedFacts: 13, evidenceOnly: 9, exceptions: 0 } },
  { name: "ICBP H1 2025", candidates: icbp, expected: { verifiedFacts: 13, evidenceOnly: 9, exceptions: 0 } },
  { name: "ICBP H1 2026 live staging", candidates: icbp2026Staging, expected: { verifiedFacts: 13, evidenceOnly: 13, exceptions: 0 } },
  { name: "MEDC H1 2025", candidates: medcH1, expected: { verifiedFacts: 12, evidenceOnly: 17, exceptions: 0 } },
  { name: "MEDC FY 2025", candidates: medcFy, expected: { verifiedFacts: 12, evidenceOnly: 23, exceptions: 0 } },
  { name: "LSIP Q1 2026", candidates: lsip, expected: { verifiedFacts: 13, evidenceOnly: 4, exceptions: 0 } },
]) {
  test(`${fixture.name} golden canonical decisions are complete and exception-free`, () => {
    const decisions = classifyCanonicalCandidates(fixture.candidates);
    const summary = summarizeCanonicalDecisions(decisions);
    assert.deepEqual({ verifiedFacts: summary.verifiedFacts, evidenceOnly: summary.evidenceOnly, exceptions: summary.exceptions }, fixture.expected);
    assert.equal(new Set(summary.verifiedCodes).size, summary.verifiedFacts);
  });
}

test("golden values preserve source units and deterministic accounting equations", () => {
  const drmaDecisions = classifyCanonicalCandidates(drma);
  assert.equal(acceptedValue(drmaDecisions, "TOTAL_DEBT"), 278_683_993_522);
  assert.equal(acceptedValue(drmaDecisions, "CAPEX"), -313_970_875_677);
  assert.equal(acceptedValue(drmaDecisions, "FCF"), 610_058_582_694);

  const icbpDecisions = classifyCanonicalCandidates(icbp);
  assert.equal(acceptedValue(icbpDecisions, "TOTAL_DEBT"), 45_818_859);
  assert.equal(icbpDecisions.filter((decision) => decision.automaticDecision === "ACCEPTED" && decision.canonicalCode === "CAPEX").length, 1);

  const medcH1Decisions = classifyCanonicalCandidates(medcH1);
  assert.equal(acceptedValue(medcH1Decisions, "CAPEX"), -185_274_393);
  assert.equal(acceptedValue(medcH1Decisions, "FCF"), 213_075_976);
  assert.ok(medcH1Decisions.some((decision) => /aset lain-lain/i.test(decision.candidate.reportedLabel) && decision.automaticDecision === "REJECTED"));
});

test("a broken gross-profit equation is never auto-accepted", () => {
  const broken = drma.map((item) => item.canonicalCode === "GROSS_PROFIT" ? { ...item, numericValue: Number(item.numericValue) + 100 } : item);
  const decisions = classifyCanonicalCandidates(broken);
  for (const code of ["REV", "COGS", "GROSS_PROFIT"]) {
    assert.equal(decisions.some((decision) => decision.canonicalCode === code && decision.automaticDecision === "ACCEPTED"), false);
  }
});

test("approved issuer mapping is reused without another AI decision", () => {
  const source = candidate("Penjualan bersih khusus emiten", 100, "INCOME_STATEMENT");
  const decisions = classifyCanonicalCandidates([source], [{
    normalizedLabel: "penjualan bersih khusus emiten",
    statementType: "INCOME_STATEMENT",
    canonicalCode: "REV",
    confidence: 1,
    method: "RULE",
  }]);
  assert.equal(decisions[0].automaticDecision, "ACCEPTED");
  assert.equal(decisions[0].canonicalCode, "REV");
  assert.equal(decisions[0].mappingMethod, "RULE");
});

test("low-confidence source evidence remains an exception", () => {
  const source = { ...candidate("Penjualan neto", 100, "INCOME_STATEMENT", "REV"), extractionConfidence: 0.9 };
  const decisions = classifyCanonicalCandidates([source]);
  assert.equal(decisions[0].automaticDecision, "PENDING");
  assert.equal(decisions[0].qualityStatus, "YELLOW");
});
