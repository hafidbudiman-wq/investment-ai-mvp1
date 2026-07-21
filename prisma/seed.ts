import { PrismaClient, PeriodType, RecordStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const icbp = await prisma.company.upsert({
    where: { ticker: "ICBP" },
    update: {},
    create: {
      ticker: "ICBP",
      name: "Indofood CBP Sukses Makmur Tbk",
      sector: "Consumer Non-Cyclicals"
    }
  });

  await prisma.financialStatement.upsert({
    where: {
      companyId_fiscalYear_periodType: {
        companyId: icbp.id,
        fiscalYear: 2026,
        periodType: PeriodType.Q1
      }
    },
    update: {},
    create: {
      companyId: icbp.id,
      fiscalYear: 2026,
      periodType: PeriodType.Q1,
      periodEndDate: new Date("2026-03-31"),
      status: RecordStatus.APPROVED,
      unit: "million",
      sourceDocument: "Sample seed data — replace with verified filing",
      revenue: 20100000,
      grossProfit: 6800000,
      operatingProfit: 3500000,
      netProfit: 2400000,
      cash: 28500000,
      receivables: 8200000,
      inventory: 14800000,
      totalAssets: 135000000,
      totalDebt: 59000000,
      equity: 76000000,
      operatingCashFlow: 3000000,
      capitalExpenditure: 1200000
    }
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
