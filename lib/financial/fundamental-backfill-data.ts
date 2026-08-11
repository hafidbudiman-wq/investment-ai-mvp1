export type FundamentalStatementType = "INCOME_STATEMENT" | "BALANCE_SHEET" | "CASH_FLOW";

export type FundamentalFact = {
  code: string;
  label: string;
  value: number;
  statementType: FundamentalStatementType;
  sourcePage: number;
  currency?: string;
};

export type FundamentalBackfillDataset = {
  version: string;
  ticker: "ICBP" | "DRMA" | "MEDC";
  year: number;
  periodType: "H1" | "FY";
  checksum: string;
  currency: "IDR" | "USD";
  unitScale: number;
  facts: readonly FundamentalFact[];
};

const fact = (
  code: string,
  label: string,
  value: number,
  statementType: FundamentalStatementType,
  sourcePage: number,
  currency?: string,
): FundamentalFact => ({ code, label, value, statementType, sourcePage, currency });

const icbpFacts = [
  fact("CASH", "Kas dan setara kas", 27_296_335, "BALANCE_SHEET", 4),
  fact("SHORT_TERM_INVESTMENTS", "Investasi jangka pendek", 2_395_540, "BALANCE_SHEET", 4),
  fact("AR", "Piutang usaha - total neto", 10_720_256, "BALANCE_SHEET", 4),
  fact("OTHER_RECEIVABLES", "Piutang bukan usaha - total", 559_254, "BALANCE_SHEET", 4),
  fact("INV", "Persediaan - neto", 6_873_859, "BALANCE_SHEET", 4),
  fact("CURRENT_ASSETS", "Total Aset Lancar", 49_238_213, "BALANCE_SHEET", 4),
  fact("PPE", "Aset tetap - neto", 15_934_426, "BALANCE_SHEET", 4),
  fact("RIGHT_OF_USE_ASSETS", "Aset hak guna - neto", 344_934, "BALANCE_SHEET", 4),
  fact("GOODWILL", "Goodwill", 54_006_155, "BALANCE_SHEET", 4),
  fact("INTANGIBLE_ASSETS", "Aset tak berwujud - neto", 1_246_221, "BALANCE_SHEET", 4),
  fact("LONG_TERM_INVESTMENTS", "Investasi jangka panjang", 6_205_993, "BALANCE_SHEET", 4),
  fact("TOTAL_ASSETS", "TOTAL ASET", 131_995_676, "BALANCE_SHEET", 4),
  fact("AP", "Utang usaha - total", 4_353_532, "BALANCE_SHEET", 5),
  fact("SHORT_TERM_DEBT", "Utang berbunga lancar selain sewa", 621_216, "BALANCE_SHEET", 5),
  fact("CURRENT_LIAB", "Total Liabilitas Jangka Pendek", 14_444_778, "BALANCE_SHEET", 5),
  fact("LONG_TERM_DEBT", "Utang berbunga jangka panjang selain sewa", 44_919_281, "BALANCE_SHEET", 5),
  fact("LEASE_LIABILITIES", "Liabilitas sewa - lancar dan tidak lancar", 278_362, "BALANCE_SHEET", 5),
  fact("TOTAL_DEBT", "Total utang berbunga termasuk liabilitas sewa", 45_818_859, "BALANCE_SHEET", 5),
  fact("TOTAL_LIAB", "TOTAL LIABILITAS", 62_495_900, "BALANCE_SHEET", 5),
  fact("EQUITY_PARENT", "Ekuitas yang Dapat Diatribusikan kepada Pemilik Entitas Induk", 47_532_078, "BALANCE_SHEET", 6),
  fact("NCI", "Kepentingan Nonpengendali", 21_967_698, "BALANCE_SHEET", 6),
  fact("EQUITY", "TOTAL EKUITAS", 69_499_776, "BALANCE_SHEET", 6),
  fact("RETAINED_EARNINGS", "Saldo laba - cadangan umum dan belum ditentukan penggunaannya", 41_581_434, "BALANCE_SHEET", 6),
  fact("SHARES_ISSUED", "Modal ditempatkan dan disetor penuh - jumlah saham", 11_661_908_000, "BALANCE_SHEET", 6, "SHARES"),
  fact("TREASURY_SHARES", "Saham treasuri", 0, "BALANCE_SHEET", 6, "SHARES"),
  fact("SHARES_OUTSTANDING", "Jumlah saham beredar", 11_661_908_000, "BALANCE_SHEET", 88, "SHARES"),
  fact("REV", "PENJUALAN NETO", 37_600_928, "INCOME_STATEMENT", 7),
  fact("COGS", "BEBAN POKOK PENJUALAN", 24_478_388, "INCOME_STATEMENT", 7),
  fact("GROSS_PROFIT", "LABA BRUTO", 13_122_540, "INCOME_STATEMENT", 7),
  fact("SGA", "Beban penjualan dan distribusi serta beban umum dan administrasi", 5_192_623, "INCOME_STATEMENT", 7),
  fact("OPERATING_PROFIT", "LABA USAHA", 8_475_878, "INCOME_STATEMENT", 7),
  fact("FINANCE_INCOME", "Pendapatan keuangan", 486_751, "INCOME_STATEMENT", 7),
  fact("FINANCE_COST", "Beban keuangan", 1_294_976, "INCOME_STATEMENT", 7),
  fact("PRETAX_PROFIT", "LABA SEBELUM BEBAN PAJAK PENGHASILAN", 7_742_091, "INCOME_STATEMENT", 7),
  fact("TAX_EXPENSE", "Beban pajak penghasilan", 1_536_498, "INCOME_STATEMENT", 7),
  fact("NET_PROFIT", "LABA PERIODE BERJALAN", 6_205_593, "INCOME_STATEMENT", 7),
  fact("NET_PROFIT_PARENT", "Laba periode berjalan yang dapat diatribusikan kepada pemilik entitas induk", 5_536_138, "INCOME_STATEMENT", 8),
  fact("EPS_BASIC", "Laba per saham dasar", 475, "INCOME_STATEMENT", 8),
  fact("WEIGHTED_AVG_SHARES", "Jumlah rata-rata tertimbang saham", 11_661_908_000, "INCOME_STATEMENT", 88, "SHARES"),
  fact("OCF", "Kas Neto yang Diperoleh dari Aktivitas Operasi", 4_844_057, "CASH_FLOW", 10),
  fact("CAPEX", "Penambahan aset tetap dan uang muka pembelian aset tetap", -2_447_972, "CASH_FLOW", 10),
  fact("ICF", "Kas Neto yang Digunakan untuk Aktivitas Investasi", -2_423_915, "CASH_FLOW", 10),
  fact("CFF", "Kas Neto yang Digunakan untuk Aktivitas Pendanaan", -755_944, "CASH_FLOW", 10),
  fact("DIVIDENDS_PAID", "Pembayaran dividen kepada kepentingan nonpengendali", -582_635, "CASH_FLOW", 10),
  fact("DEBT_ISSUED", "Penerimaan utang bank jangka pendek dan jangka panjang", 271_442, "CASH_FLOW", 10),
  fact("DEBT_REPAID", "Pembayaran utang bank jangka pendek dan jangka panjang", -365_414, "CASH_FLOW", 10),
  fact("FCF", "Arus kas bebas = OCF + CAPEX", 2_396_085, "CASH_FLOW", 10),
  fact("NET_CHANGE_CASH", "Kenaikan neto kas dan setara kas", 2_003_695, "CASH_FLOW", 10),
] as const;

const drmaFacts = [
  fact("CASH", "Kas dan setara kas", 592_275_512_729, "BALANCE_SHEET", 4),
  fact("AR", "Piutang usaha - pihak berelasi dan pihak ketiga", 752_733_235_975, "BALANCE_SHEET", 4),
  fact("OTHER_RECEIVABLES", "Piutang non-usaha - pihak berelasi dan pihak ketiga", 11_420_722_938, "BALANCE_SHEET", 4),
  fact("INV", "Persediaan", 524_580_310_093, "BALANCE_SHEET", 4),
  fact("CURRENT_ASSETS", "Total Aset Lancar", 2_035_504_953_164, "BALANCE_SHEET", 4),
  fact("PPE", "Aset tetap", 1_904_960_235_937, "BALANCE_SHEET", 4),
  fact("RIGHT_OF_USE_ASSETS", "Aset hak-guna", 115_663_335, "BALANCE_SHEET", 4),
  fact("LONG_TERM_INVESTMENTS", "Investasi pada entitas asosiasi", 231_448_174_651, "BALANCE_SHEET", 4),
  fact("TOTAL_ASSETS", "TOTAL ASET", 4_286_878_723_108, "BALANCE_SHEET", 4),
  fact("AP", "Utang usaha", 651_019_340_258, "BALANCE_SHEET", 5),
  fact("SHORT_TERM_DEBT", "Utang berbunga lancar selain sewa", 172_949_624_401, "BALANCE_SHEET", 5),
  fact("CURRENT_LIAB", "Total Liabilitas Jangka Pendek", 1_084_625_394_410, "BALANCE_SHEET", 5),
  fact("LONG_TERM_DEBT", "Utang bank jangka panjang", 105_607_150_517, "BALANCE_SHEET", 5),
  fact("LEASE_LIABILITIES", "Liabilitas sewa - lancar dan tidak lancar", 127_218_604, "BALANCE_SHEET", 5),
  fact("TOTAL_DEBT", "Total utang berbunga termasuk liabilitas sewa", 278_683_993_522, "BALANCE_SHEET", 5),
  fact("TOTAL_LIAB", "Total Liabilitas", 1_351_223_609_596, "BALANCE_SHEET", 5),
  fact("EQUITY_PARENT", "Total ekuitas yang diatribusikan kepada pemilik entitas induk", 2_775_760_819_361, "BALANCE_SHEET", 5),
  fact("NCI", "Kepentingan non-pengendali", 159_894_294_151, "BALANCE_SHEET", 5),
  fact("EQUITY", "Total Ekuitas", 2_935_655_113_512, "BALANCE_SHEET", 5),
  fact("RETAINED_EARNINGS", "Saldo laba", 2_008_643_047_495, "BALANCE_SHEET", 5),
  fact("SHARES_ISSUED", "Modal ditempatkan dan disetor penuh - jumlah saham", 4_705_882_300, "BALANCE_SHEET", 5, "SHARES"),
  fact("TREASURY_SHARES", "Saham treasuri", 0, "BALANCE_SHEET", 5, "SHARES"),
  fact("SHARES_OUTSTANDING", "Jumlah saham biasa beredar", 4_705_882_300, "BALANCE_SHEET", 75, "SHARES"),
  fact("REV", "PENJUALAN NETO", 5_939_676_041_503, "INCOME_STATEMENT", 6),
  fact("COGS", "BEBAN POKOK PENJUALAN", 4_869_211_295_212, "INCOME_STATEMENT", 6),
  fact("GROSS_PROFIT", "LABA BRUTO", 1_070_464_746_291, "INCOME_STATEMENT", 6),
  fact("SGA", "Beban penjualan dan pemasaran serta beban umum dan administrasi", 380_303_352_125, "INCOME_STATEMENT", 6),
  fact("OPERATING_PROFIT", "LABA USAHA", 843_558_843_036, "INCOME_STATEMENT", 6),
  fact("FINANCE_INCOME", "Pendapatan keuangan", 19_600_931_450, "INCOME_STATEMENT", 6),
  fact("FINANCE_COST", "Beban keuangan", 32_135_649_832, "INCOME_STATEMENT", 6),
  fact("PRETAX_PROFIT", "LABA SEBELUM PAJAK PENGHASILAN", 831_024_124_654, "INCOME_STATEMENT", 6),
  fact("TAX_EXPENSE", "Beban pajak penghasilan - neto", 166_609_994_386, "INCOME_STATEMENT", 6),
  fact("NET_PROFIT", "LABA NETO UNTUK TAHUN BERJALAN", 664_414_130_268, "INCOME_STATEMENT", 6),
  fact("NET_PROFIT_PARENT", "Laba neto yang dapat diatribusikan kepada pemilik entitas induk", 652_584_272_073, "INCOME_STATEMENT", 7),
  fact("EPS_BASIC", "Laba per saham dasar", 139, "INCOME_STATEMENT", 7),
  fact("EPS_DILUTED", "Laba per saham dilusian", 139, "INCOME_STATEMENT", 75),
  fact("WEIGHTED_AVG_SHARES", "Rata-rata tertimbang jumlah saham biasa yang beredar", 4_705_882_300, "INCOME_STATEMENT", 75, "SHARES"),
  fact("OCF", "Kas neto diperoleh dari aktivitas operasi", 924_029_458_371, "CASH_FLOW", 12),
  fact("CAPEX", "Perolehan aset tetap dan penambahan uang muka untuk aset tetap", -313_970_875_677, "CASH_FLOW", 12),
  fact("ICF", "Kas neto digunakan untuk aktivitas investasi", -321_372_809_512, "CASH_FLOW", 12),
  fact("CFF", "Kas neto digunakan untuk aktivitas pendanaan", -411_930_981_008, "CASH_FLOW", 13),
  fact("DIVIDENDS_PAID", "Pembayaran dividen kas kepada pemegang saham dan kepentingan non-pengendali", -215_474_538_000, "CASH_FLOW", 13),
  fact("DEBT_ISSUED", "Penerimaan utang bank jangka panjang dan jangka pendek", 26_730_183_521, "CASH_FLOW", 13),
  fact("DEBT_REPAID", "Pembayaran utang bank jangka panjang", -223_313_845_133, "CASH_FLOW", 13),
  fact("FCF", "Arus kas bebas = OCF + CAPEX", 610_058_582_694, "CASH_FLOW", 12),
  fact("NET_CHANGE_CASH", "KENAIKAN NETO KAS DAN SETARA KAS", 190_514_829_678, "CASH_FLOW", 13),
] as const;

const medcFacts = [
  fact("CASH", "Kas dan setara kas", 824_287_275, "BALANCE_SHEET", 4),
  fact("SHORT_TERM_INVESTMENTS", "Investasi jangka pendek", 11_025_599, "BALANCE_SHEET", 4),
  fact("AR", "Piutang usaha - pihak berelasi dan pihak ketiga", 444_881_155, "BALANCE_SHEET", 4),
  fact("OTHER_RECEIVABLES", "Piutang lain-lain - lancar dan tidak lancar", 381_363_910, "BALANCE_SHEET", 4),
  fact("INV", "Persediaan", 155_743_076, "BALANCE_SHEET", 4),
  fact("CURRENT_ASSETS", "Jumlah Aset Lancar", 2_104_499_133, "BALANCE_SHEET", 4),
  fact("PPE", "Aset tetap", 109_862_248, "BALANCE_SHEET", 4),
  fact("EXPLORATION_ASSETS", "Aset eksplorasi dan evaluasi", 245_851_476, "BALANCE_SHEET", 4),
  fact("OIL_GAS_PROPERTIES", "Aset minyak dan gas bumi", 2_593_510_133, "BALANCE_SHEET", 4),
  fact("RIGHT_OF_USE_ASSETS", "Aset hak guna", 207_496_646, "BALANCE_SHEET", 4),
  fact("GOODWILL", "Goodwill", 39_066_445, "BALANCE_SHEET", 4),
  fact("LONG_TERM_INVESTMENTS", "Investasi pada saham", 1_758_914_429, "BALANCE_SHEET", 4),
  fact("TOTAL_ASSETS", "JUMLAH ASET", 8_073_314_788, "BALANCE_SHEET", 4),
  fact("AP", "Utang usaha - pihak berelasi dan pihak ketiga", 319_412_015, "BALANCE_SHEET", 5),
  fact("SHORT_TERM_DEBT", "Utang berbunga lancar selain sewa", 317_090_500, "BALANCE_SHEET", 5),
  fact("CURRENT_LIAB", "Jumlah Liabilitas Jangka Pendek", 1_465_997_615, "BALANCE_SHEET", 5),
  fact("LONG_TERM_DEBT", "Utang berbunga jangka panjang selain sewa", 3_140_429_146, "BALANCE_SHEET", 5),
  fact("LEASE_LIABILITIES", "Liabilitas sewa - lancar dan tidak lancar", 278_355_062, "BALANCE_SHEET", 5),
  fact("TOTAL_DEBT", "Total utang berbunga termasuk liabilitas sewa", 3_735_874_708, "BALANCE_SHEET", 5),
  fact("TOTAL_LIAB", "Jumlah Liabilitas", 5_768_641_486, "BALANCE_SHEET", 5),
  fact("EQUITY_PARENT", "Jumlah ekuitas yang dapat diatribusikan kepada pemilik entitas induk", 2_071_197_306, "BALANCE_SHEET", 7),
  fact("NCI", "Kepentingan nonpengendali", 233_475_996, "BALANCE_SHEET", 7),
  fact("EQUITY", "Jumlah Ekuitas", 2_304_673_302, "BALANCE_SHEET", 7),
  fact("RETAINED_EARNINGS", "Saldo laba - ditentukan dan tidak ditentukan penggunaannya", 1_543_893_421, "BALANCE_SHEET", 7),
  fact("SHARES_ISSUED", "Saham diterbitkan dan disetor penuh", 25_136_231_252, "BALANCE_SHEET", 7, "SHARES"),
  fact("TREASURY_SHARES", "Saham treasuri", 453_229_508, "BALANCE_SHEET", 7, "SHARES"),
  fact("SHARES_OUTSTANDING", "Jumlah saham beredar setelah saham treasuri", 24_683_001_744, "BALANCE_SHEET", 186, "SHARES"),
  fact("REV", "JUMLAH PENDAPATAN", 1_138_390_027, "INCOME_STATEMENT", 8),
  fact("COGS", "JUMLAH BEBAN POKOK PENDAPATAN DAN BIAYA LANGSUNG LAINNYA", 702_600_099, "INCOME_STATEMENT", 8),
  fact("GROSS_PROFIT", "LABA KOTOR", 435_789_928, "INCOME_STATEMENT", 8),
  fact("SGA", "Beban penjualan, umum dan administrasi", 97_976_286, "INCOME_STATEMENT", 8),
  fact("FINANCE_INCOME", "Pendapatan keuangan", 23_630_000, "INCOME_STATEMENT", 8),
  fact("FINANCE_COST", "Beban pendanaan", 169_426_281, "INCOME_STATEMENT", 8),
  fact("PRETAX_PROFIT", "Laba sebelum pajak penghasilan dari operasi yang dilanjutkan", 182_471_257, "INCOME_STATEMENT", 8),
  fact("TAX_EXPENSE", "Beban pajak penghasilan", 139_872_923, "INCOME_STATEMENT", 8),
  fact("NET_PROFIT", "LABA PERIODE BERJALAN", 42_420_559, "INCOME_STATEMENT", 9),
  fact("NET_PROFIT_PARENT", "Laba periode berjalan yang diatribusikan kepada pemilik entitas induk", 37_188_257, "INCOME_STATEMENT", 9),
  fact("EPS_BASIC", "Laba per saham dasar", 0.0015, "INCOME_STATEMENT", 9),
  fact("WEIGHTED_AVG_SHARES", "Rata-rata tertimbang saham biasa yang beredar", 24_766_734_214, "INCOME_STATEMENT", 215, "SHARES"),
  fact("OCF", "Kas neto diperoleh dari aktivitas operasi", 398_350_369, "CASH_FLOW", 13),
  fact("CAPEX", "Penambahan aset eksplorasi, aset konsesi, aset tetap, serta aset minyak dan gas bumi", -185_274_393, "CASH_FLOW", 13),
  fact("ICF", "Kas neto digunakan untuk aktivitas investasi", -46_783_511, "CASH_FLOW", 13),
  fact("CFF", "Kas neto digunakan untuk aktivitas pendanaan", -164_452_170, "CASH_FLOW", 14),
  fact("DIVIDENDS_PAID", "Pembayaran dividen dan dividen entitas anak kepada kepentingan nonpengendali", -41_223_889, "CASH_FLOW", 14),
  fact("DEBT_ISSUED", "Hasil yang diperoleh dari pinjaman bank dan utang jangka panjang", 1_092_992_711, "CASH_FLOW", 14),
  fact("DEBT_REPAID", "Pembayaran pinjaman bank dan utang jangka panjang lainnya", -899_043_457, "CASH_FLOW", 14),
  fact("FCF", "Arus kas bebas = OCF + CAPEX produktif", 213_075_976, "CASH_FLOW", 13),
  fact("NET_CHANGE_CASH", "Perubahan kas dan setara kas dari awal sampai akhir periode", 187_262_827, "CASH_FLOW", 14),
] as const;

export const FUNDAMENTAL_BACKFILL_DATASETS = [
  {
    version: "fundamental-v1-20260809",
    ticker: "ICBP",
    year: 2025,
    periodType: "H1",
    checksum: "eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089",
    currency: "IDR",
    unitScale: 1_000_000,
    facts: icbpFacts,
  },
  {
    version: "fundamental-v1-20260809",
    ticker: "DRMA",
    year: 2025,
    periodType: "FY",
    checksum: "7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb",
    currency: "IDR",
    unitScale: 1,
    facts: drmaFacts,
  },
  {
    version: "fundamental-v1-20260809",
    ticker: "MEDC",
    year: 2025,
    periodType: "H1",
    checksum: "438675ac79b565ca4b583745bc2b2b885cf6b6fbbed8f71dcca51ef110cf880e",
    currency: "USD",
    unitScale: 1,
    facts: medcFacts,
  },
] as const satisfies readonly FundamentalBackfillDataset[];

export function factsByCode(dataset: FundamentalBackfillDataset): ReadonlyMap<string, FundamentalFact> {
  return new Map(dataset.facts.map((item) => [item.code, item]));
}
