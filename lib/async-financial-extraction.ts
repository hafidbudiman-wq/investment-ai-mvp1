import { prisma } from "@/lib/prisma";
import { parseFinancialExtractionResponse, retrieveFinancialPdfBackground } from "@/lib/openai-financial-extraction";
import { sha256 } from "@/lib/pdf-extraction";

const ASYNC_PREFIX = "mvp-1.2d-async:";

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function responseIdFromParserVersion(parserVersion: string) {
  return parserVersion.startsWith(ASYNC_PREFIX) ? parserVersion.slice(ASYNC_PREFIX.length) : null;
}

export async function syncAsyncExtractionRun(runId: string) {
  const run = await prisma.extractionRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Extraction run tidak ditemukan.");
  if (run.status !== "PROCESSING" && run.status !== "UPLOADED") return run;

  const responseId = responseIdFromParserVersion(run.parserVersion);
  if (!responseId) throw new Error("Background response id tidak ditemukan.");

  const response = await retrieveFinancialPdfBackground(responseId);
  if (response.status === "queued" || response.status === "in_progress") return run;

  if (response.status !== "completed") {
    const reason = response.error?.message || response.incomplete_details?.reason || `OpenAI background job ${response.status}.`;
    return prisma.extractionRun.update({ where: { id: run.id }, data: { status: "FAILED", errorMessage: reason.slice(0, 2000) } });
  }

  const extracted = parseFinancialExtractionResponse(response);
  const [companies, accounts] = await Promise.all([
    prisma.company.findMany({ where: { isActive: true }, select: { id: true, ticker: true, name: true, currency: true } }),
    prisma.canonicalAccount.findMany({ where: { isActive: true, isCalculated: false }, select: { id: true, code: true, name: true, statementType: true, aliases: true } }),
  ]);

  const detectedTicker = normalize(extracted.detectedCompanyTicker);
  const detectedName = normalize(extracted.detectedCompanyName);
  const exactCompany = companies.find((item) => normalize(item.ticker) === detectedTicker)
    ?? companies.find((item) => normalize(item.name) === detectedName);
  const fuzzyCompany = exactCompany
    ?? companies.find((item) => detectedName && (normalize(item.name).includes(detectedName) || detectedName.includes(normalize(item.name))))
    ?? companies.find((item) => detectedTicker && normalize(item.ticker).includes(detectedTicker));
  const companyConfidence = Math.max(0, Math.min(1, extracted.detectedCompanyConfidence ?? 0));
  const company = companyConfidence >= 0.95 ? exactCompany : undefined;

  if (!company) {
    const suggestion = fuzzyCompany ? `${fuzzyCompany.ticker} — ${fuzzyCompany.name}` : "tidak ada";
    return prisma.extractionRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        year: extracted.detectedYear,
        periodType: extracted.detectedPeriodType,
        currency: extracted.detectedCurrency,
        unitScale: extracted.detectedUnitScale,
        pageCount: extracted.pageCount,
        errorMessage: `AI mendeteksi ${extracted.detectedCompanyTicker ?? "?"} — ${extracted.detectedCompanyName ?? "?"} (confidence ${Math.round(companyConfidence * 100)}%). Company Master perlu konfirmasi; suggestion: ${suggestion}.`,
      },
    });
  }

  if (!extracted.detectedYear || !extracted.detectedPeriodType || (extracted.detectedPeriodConfidence ?? 0) < 0.75) {
    return prisma.extractionRun.update({
      where: { id: run.id },
      data: {
        companyId: company.id,
        status: "FAILED",
        year: extracted.detectedYear,
        periodType: extracted.detectedPeriodType,
        currency: extracted.detectedCurrency || company.currency,
        unitScale: extracted.detectedUnitScale,
        pageCount: extracted.pageCount,
        errorMessage: "AI belum cukup yakin menentukan periode laporan. Periode perlu dikonfirmasi sebelum review.",
      },
    });
  }

  const duplicate = await prisma.extractionRun.findFirst({
    where: { companyId: company.id, checksum: run.checksum, id: { not: run.id } },
    select: { id: true },
  });
  if (duplicate) {
    return prisma.extractionRun.update({ where: { id: run.id }, data: { status: "FAILED", errorMessage: `PDF ini sudah diproses pada run ${duplicate.id}. Job duplikat dihentikan.` } });
  }

  const accountByCode = new Map(accounts.map((account) => [account.code.toUpperCase(), account]));
  const chunks = extracted.chunks.length ? extracted.chunks : [{ section: "Financial Statements", chunkType: "SECTION" as const, pageStart: null, pageEnd: null, textSummary: "AI extraction result" }];

  await prisma.$transaction(async (tx) => {
    await tx.extractionRun.update({
      where: { id: run.id },
      data: {
        companyId: company.id,
        year: extracted.detectedYear,
        periodType: extracted.detectedPeriodType,
        currency: extracted.detectedCurrency || company.currency,
        unitScale: extracted.detectedUnitScale,
        pageCount: extracted.pageCount,
        errorMessage: null,
      },
    });

    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      await tx.extractionChunk.create({
        data: {
          runId: run.id,
          ordinal: index + 1,
          chunkType: chunk.chunkType,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          section: chunk.section,
          text: chunk.textSummary.slice(0, 12000),
          textHash: sha256(Buffer.from(chunk.textSummary)),
          metadata: { processingMode: "OPENAI_BACKGROUND", responseId },
        },
      });
    }

    for (const candidate of extracted.candidates) {
      if (candidate.numericValue === null || !Number.isFinite(candidate.numericValue)) continue;
      const canonical = candidate.canonicalCode ? accountByCode.get(candidate.canonicalCode.toUpperCase()) : undefined;
      const matchingChunk = chunks.findIndex((chunk) => candidate.sourcePage != null && chunk.pageStart != null && chunk.pageEnd != null && candidate.sourcePage >= chunk.pageStart && candidate.sourcePage <= chunk.pageEnd);
      const storedChunk = matchingChunk >= 0
        ? await tx.extractionChunk.findUnique({ where: { runId_ordinal: { runId: run.id, ordinal: matchingChunk + 1 } }, select: { id: true } })
        : null;
      await tx.extractionCandidate.create({
        data: {
          runId: run.id,
          chunkId: storedChunk?.id ?? null,
          statementType: candidate.statementType,
          reportedLabel: candidate.reportedLabel.slice(0, 500),
          normalizedLabel: candidate.reportedLabel.trim().toLowerCase().slice(0, 500),
          rawValue: candidate.rawValue.slice(0, 250),
          numericValue: candidate.numericValue,
          currency: candidate.currency || extracted.detectedCurrency || company.currency,
          scale: candidate.scale || extracted.detectedUnitScale || 1,
          sourcePage: candidate.sourcePage,
          sourceText: candidate.sourceText?.slice(0, 2000) ?? null,
          canonicalAccountId: canonical?.id ?? null,
          extractionConfidence: Math.max(0, Math.min(1, candidate.extractionConfidence)),
          mappingConfidence: canonical ? Math.max(0, Math.min(1, candidate.mappingConfidence)) : 0,
          mappingMethod: canonical ? "AI" : null,
          status: "PENDING",
        },
      });
    }

    await tx.extractionRun.update({ where: { id: run.id }, data: { status: "PENDING_REVIEW" } });
  });

  return prisma.extractionRun.findUnique({ where: { id: run.id } });
}
