import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourcePath = "tmp/full-schema.sql";
const outputPath = "prisma/migrations/20260731130000_legacy_financial_foundation/migration.sql";
const platformTables = [
  "UploadSession",
  "UploadPart",
  "FinancialDocument",
  "Job",
  "JobAttempt",
  "JobEvent",
  "MetadataAssertion",
];

const source = await readFile(sourcePath, "utf8");
const blocks = source.split(/\n(?=-- (?:CreateEnum|CreateTable|CreateIndex|AddForeignKey))/);

const transformed = blocks
  .filter((block) => !platformTables.some((table) => block.includes(`"${table}"`)))
  .map((block) => {
    if (block.includes("-- CreateEnum")) {
      const statement = block.match(/CREATE TYPE[\s\S]+;/)?.[0];
      if (!statement) throw new Error(`Unable to parse enum block:\n${block}`);
      return block.replace(statement, () => `DO $$ BEGIN\n  ${statement}\nEXCEPTION\n  WHEN duplicate_object THEN NULL;\nEND $$;`);
    }
    if (block.includes("-- CreateTable")) {
      return block.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ");
    }
    if (block.includes("-- CreateIndex")) {
      return block
        .replace("CREATE UNIQUE INDEX ", "CREATE UNIQUE INDEX IF NOT EXISTS ")
        .replace("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ");
    }
    if (block.includes("-- AddForeignKey")) {
      const match = block.match(/ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" ([\s\S]+);/);
      if (!match) throw new Error(`Unable to parse foreign-key block:\n${block}`);
      const [, , constraintName] = match;
      const statement = match[0];
      return block.replace(statement, () => `DO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}') THEN\n    ${statement}\n  END IF;\nEND $$;`);
    }
    return block;
  });

await mkdir(outputPath.slice(0, outputPath.lastIndexOf("/")), { recursive: true });
await writeFile(
  outputPath,
  `-- Idempotent adoption baseline for legacy InvestAI financial/extraction tables.\n-- Safe for an empty database and for Railway databases previously created with prisma db push.\n\n${transformed.join("\n").trim()}\n`,
);
