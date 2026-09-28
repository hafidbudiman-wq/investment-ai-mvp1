import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Prisma } from "@prisma/client";
import { persistP0ACompatibleResult } from "../lib/financial/p0a/ocr-persistence";
import { runP0ACompatiblePipeline } from "../lib/financial/p0a/pipeline";
import type { P0AIssuerContext } from "../lib/financial/p0a/types";
import { runPhase6A } from "../lib/financial/p0b/phase6a-pipeline";
import { persistPhase6A } from "../lib/financial/p0b/persistence";
import { runPhase6B } from "../lib/financial/p0b/phase6b-pipeline";
import { persistPhase6B } from "../lib/financial/p0b/phase6b-persistence";
import { runPhase7A } from "../lib/financial/p0b/phase7a-pipeline";
import { persistPhase7A } from "../lib/financial/p0b/phase7a-persistence";
import { prisma } from "../lib/prisma";

const sha=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
let databaseName=""; try{databaseName=new URL(process.env.DATABASE_URL??"").pathname.slice(1);}catch{}
if(databaseName!=="investai_phase7a_acceptance") throw new Error("Refusing Phase 7A acceptance outside disposable investai_phase7a_acceptance.");

type Issuer="ICBP"|"MEDC"|"DRMA";
type Case={ticker:Issuer;name:string;fileName:string;path:string;expectedSha:string;context:P0AIssuerContext;expectedOcr:number[]};
const cases:Case[]=[
 {ticker:"ICBP",name:"Indofood CBP Sukses Makmur Tbk",fileName:"ICBP_billingual_30Jun25.pdf",path:process.env.P0A_ICBP_PDF_PATH??"",expectedSha:"eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089",context:{ticker:"ICBP",issuerType:"LISTED_COMMON_EQUITY",accountingModel:"NON_FINANCIAL",consolidated:true,audited:false,periodStart:"2025-01-01",periodEnd:"2025-06-30",periodType:"H1",currency:"IDR",documentScale:"1000000"},expectedOcr:[]},
 {ticker:"MEDC",name:"Medco Energi Internasional Tbk",fileName:"MEDC_1H25.pdf",path:process.env.P0A_MEDC_PDF_PATH??"",expectedSha:"438675ac79b565ca4b583745bc2b2b885cf6b6fbbed8f71dcca51ef110cf880e",context:{ticker:"MEDC",issuerType:"LISTED_COMMON_EQUITY",accountingModel:"NON_FINANCIAL",consolidated:true,audited:false,periodStart:"2025-01-01",periodEnd:"2025-06-30",periodType:"H1",currency:"USD",documentScale:"1"},expectedOcr:[]},
 {ticker:"DRMA",name:"Dharma Polimetal Tbk",fileName:"DRMA_Q4_2025.pdf",path:process.env.P0A_DRMA_PDF_PATH??"",expectedSha:"7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb",context:{ticker:"DRMA",issuerType:"LISTED_COMMON_EQUITY",accountingModel:"NON_FINANCIAL",consolidated:true,audited:true,periodStart:"2025-01-01",periodEnd:"2025-12-31",periodType:"FY",currency:"IDR",documentScale:"1"},expectedOcr:[4,5,6,7]},
];
const countModels={
 Company:()=>prisma.company.count(),CanonicalAccount:()=>prisma.canonicalAccount.count(),FinancialEntry:()=>prisma.financialEntry.count(),FinancialDocument:()=>prisma.financialDocument.count(),
 P0AExtractionPass:()=>prisma.p0AExtractionPass.count(),P0ARequirementOutcome:()=>prisma.p0ARequirementOutcome.count(),P0AFactAssertion:()=>prisma.p0AFactAssertion.count(),P0AFactEvidence:()=>prisma.p0AFactEvidence.count(),
 P0BExtractionRun:()=>prisma.p0BExtractionRun.count(),P0BRequirementOutcome:()=>prisma.p0BRequirementOutcome.count(),DerivedMetricResult:()=>prisma.derivedMetricResult.count(),DerivedMetricInput:()=>prisma.derivedMetricInput.count(),
 Phase6BExtractionRun:()=>prisma.phase6BExtractionRun.count(),DividendEvent:()=>prisma.dividendEvent.count(),SegmentDimension:()=>prisma.segmentDimension.count(),SegmentFact:()=>prisma.segmentFact.count(),
 Phase7AExtractionRun:()=>prisma.phase7AExtractionRun.count(),Phase7AOutcome:()=>prisma.phase7AOutcome.count(),
} as const;
async function counts(){return Object.fromEntries(await Promise.all(Object.entries(countModels).map(async([k,v])=>[k,await v()])));}
const stable=(v:unknown)=>JSON.stringify(v,(_k,x)=>Prisma.Decimal.isDecimal(x)?x.toFixed():x instanceof Date?x.toISOString():x);
async function writeJson(path:string,v:unknown){await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(v,null,2)+"\n","utf8");}
async function snapshot(path:string){const r={capturedAt:new Date().toISOString(),databaseName,counts:await counts()};await writeJson(path,r);console.log(JSON.stringify(r,null,2));}
async function source(item:Case){if(!item.path)throw new Error(`Missing source path for ${item.ticker}`);const b=await readFile(item.path);assert.equal(sha(b),item.expectedSha);return b;}

async function frozenCurrentFingerprints(){
 const p0a=await prisma.p0ARequirementOutcome.findMany({orderBy:[{passId:"asc"},{requirementId:"asc"}],include:{reportedAssertion:true}});
 const p0b=await prisma.p0BRequirementOutcome.findMany({orderBy:[{runId:"asc"},{requirementId:"asc"}],include:{reportedAssertion:true,derivedResult:true}});
 const events=await prisma.dividendEvent.findMany({orderBy:{eventKey:"asc"}});
 const segments=await prisma.segmentFact.findMany({where:{presentationRole:null},orderBy:{factKey:"asc"},include:{segment:true}});
 return {
  p0a:sha(stable(p0a.map(o=>({passId:o.passId,requirementId:o.requirementId,state:o.state,assertion:o.reportedAssertion?{key:o.reportedAssertion.assertionKey,value:o.reportedAssertion.decimalValue,currency:o.reportedAssertion.currency,scale:o.reportedAssertion.scale}:null})))),
  phase6a:sha(stable(p0b.map(o=>({runId:o.runId,requirementId:o.requirementId,state:o.state,reported:o.reportedAssertion?{key:o.reportedAssertion.assertionKey,value:o.reportedAssertion.decimalValue}:null,derived:o.derivedResult?{hash:o.derivedResult.resultHash,value:o.derivedResult.decimalValue,periodStart:o.derivedResult.periodStart,periodEnd:o.derivedResult.periodEnd}:null})))),
  phase6bEvents:sha(stable(events.map(e=>({eventKey:e.eventKey,eventType:e.eventType,status:e.status,profitStart:e.sourceProfitPeriodStart,profitEnd:e.sourceProfitPeriodEnd,approval:e.approvalDate,payment:e.paymentDate,total:e.totalAmount,totalCurrency:e.totalCurrency,perShare:e.perShareAmount,perShareCurrency:e.perShareCurrency,recipient:e.recipientScope,shareClass:e.shareClass})))),
  phase6bSegments:sha(stable(segments.map(f=>({factKey:f.factKey,identityKey:f.segment.identityKey,metric:f.metricCode,salesScope:f.salesScope,value:f.normalizedValue,currency:f.currency,scale:f.scale,periodStart:f.periodStart,periodEnd:f.periodEnd,periodType:f.periodType})))),
 };
}
async function prepare(path:string){
 const issuers:Array<{ticker:Issuer;companyId:string;documentId:string;reportRevisionId:string;p0aFingerprint:string;phase6aRunIdentity:string;phase6bRunIdentity:string}>=[];
 for(const item of cases){
  const bytes=await source(item);
  const company=await prisma.company.upsert({where:{ticker:item.ticker},create:{ticker:item.ticker,name:item.name,currency:item.context.currency},update:{}});
  const objectKey=`phase7a/${item.ticker}/${item.expectedSha}.pdf`;
  const document=await prisma.financialDocument.upsert({where:{objectKey},create:{storageProvider:"github-actions-ephemeral",bucket:"phase7a-acceptance",objectKey,originalFileName:item.fileName,mimeType:"application/pdf",verifiedSize:bytes.length,sha256:item.expectedSha,content:bytes,magicBytesVerified:true,status:"VERIFIED",verifiedAt:new Date()},update:{}});
  const p0a=await runP0ACompatiblePipeline({bytes,context:item.context}); assert.deepEqual(p0a.ocrUsage.ocrPages,item.expectedOcr); assert.equal(p0a.usage.providerCalls,0);
  const p0aStored=await persistP0ACompatibleResult(prisma,{documentId:document.id,companyId:company.id,context:item.context,result:p0a});
  const revision=await prisma.p0AReportRevision.findUniqueOrThrow({where:{passId:p0aStored.passId}});
  const p6a=await runPhase6A({bytes,context:item.context,p0aResult:p0a}); await persistPhase6A(prisma,{documentId:document.id,companyId:company.id,reportRevisionId:revision.id,result:p6a});
  const p6b=await runPhase6B({bytes,context:item.context,p0aResult:p0a}); await persistPhase6B(prisma,{documentId:document.id,companyId:company.id,reportRevisionId:revision.id,result:p6b});
  issuers.push({ticker:item.ticker,companyId:company.id,documentId:document.id,reportRevisionId:revision.id,p0aFingerprint:p6a.p0a.outcomeFingerprint,phase6aRunIdentity:p6a.runIdentity,phase6bRunIdentity:p6b.runIdentity});
 }
 const r={capturedAt:new Date().toISOString(),counts:await counts(),frozenFingerprints:await frozenCurrentFingerprints(),issuers};await writeJson(path,r);console.log(JSON.stringify(r,null,2));
}
async function persist(ticker:Issuer,label:string,path:string){
 const item=cases.find(c=>c.ticker===ticker)!;const bytes=await source(item);const company=await prisma.company.findUniqueOrThrow({where:{ticker}});
 const document=await prisma.financialDocument.findUniqueOrThrow({where:{objectKey:`phase7a/${ticker}/${item.expectedSha}.pdf`}});
 const revision=await prisma.p0AReportRevision.findFirstOrThrow({where:{companyId:company.id,documentId:document.id}});
 const result=await runPhase7A({bytes,context:item.context}); assert.deepEqual(result.p0a.ocrPages,item.expectedOcr); assert.equal(result.providerUsage.providerCalls,0);
 const stored=await persistPhase7A(prisma,{documentId:document.id,companyId:company.id,reportRevisionId:revision.id,result});
 const record={label,ticker,runIdentity:result.runIdentity,comparativePeriods:result.comparativePeriods,reportedFactCount:result.reportedFacts.length,derivedFactCount:result.derivedFacts.length,segmentFactCount:result.segmentFacts.length,dividendDedup:result.dividendDedup,validations:result.validations,persistenceCounts:stored.counts,ocrPages:result.p0a.ocrPages,providerUsage:result.providerUsage};await writeJson(path,record);console.log(JSON.stringify(record,null,2));
}
async function verify(baselinePath:string,seed1Path:string,seed2Path:string,firstPath:string,secondPath:string,output:string){
 const baseline=JSON.parse(await readFile(baselinePath,"utf8")),seed1=JSON.parse(await readFile(seed1Path,"utf8")),seed2=JSON.parse(await readFile(seed2Path,"utf8")),first=JSON.parse(await readFile(firstPath,"utf8")),second=JSON.parse(await readFile(secondPath,"utf8"));
 assert.deepEqual(seed2.counts,seed1.counts,"seed twice idempotency"); assert.deepEqual(second.counts,first.counts,"Phase 7A second persistence count idempotency");
 const afterFrozen=await frozenCurrentFingerprints();assert.deepEqual(afterFrozen,baseline.frozenFingerprints,"frozen current P0-A/6A/6B substantive fingerprints");
 const duplicates=await prisma.$queryRaw<Array<{check:string;duplicates:bigint}>>(Prisma.sql`
 SELECT 'Phase7ARun.identity' check,COUNT(*)::bigint duplicates FROM (SELECT "completeIdentityHash" FROM "Phase7AExtractionRun" GROUP BY 1 HAVING COUNT(*)>1)q
 UNION ALL SELECT 'ComparativeAssertion.temporalIdentity',COUNT(*)::bigint FROM (SELECT "temporalIdentityKey" FROM "P0AFactAssertion" WHERE "temporalIdentityKey" IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1)q
 UNION ALL SELECT 'DerivedMetric.logicalPeriod',COUNT(*)::bigint FROM (SELECT "runId","definitionId","periodStart","periodEnd" FROM "DerivedMetricResult" GROUP BY 1,2,3,4 HAVING COUNT(*)>1)q
 UNION ALL SELECT 'DerivedInput.ordinal',COUNT(*)::bigint FROM (SELECT "resultId","ordinal" FROM "DerivedMetricInput" GROUP BY 1,2 HAVING COUNT(*)>1)q
 UNION ALL SELECT 'DividendEvent.eventKey',COUNT(*)::bigint FROM (SELECT "eventKey" FROM "DividendEvent" GROUP BY 1 HAVING COUNT(*)>1)q
 UNION ALL SELECT 'SegmentDimension.identityKey',COUNT(*)::bigint FROM (SELECT "identityKey" FROM "SegmentDimension" GROUP BY 1 HAVING COUNT(*)>1)q
 UNION ALL SELECT 'SegmentFact.factKey',COUNT(*)::bigint FROM (SELECT "factKey" FROM "SegmentFact" GROUP BY 1 HAVING COUNT(*)>1)q
 UNION ALL SELECT 'SegmentFact.logicalPeriod',COUNT(*)::bigint FROM (SELECT "runId","segmentId","metricCode","salesScope","periodStart","periodEnd" FROM "SegmentFact" GROUP BY 1,2,3,4,5,6 HAVING COUNT(*)>1)q
 UNION ALL SELECT 'Phase7AOutcome.runCode',COUNT(*)::bigint FROM (SELECT "runId","code" FROM "Phase7AOutcome" GROUP BY 1,2 HAVING COUNT(*)>1)q
 `);assert.ok(duplicates.every(r=>r.duplicates===BigInt(0)));
 const temporal=await prisma.$queryRaw<Array<{instant_mismatch:bigint;duration_mismatch:bigint;not_prior:bigint;mixed_derived_inputs:bigint;segment_continuity_gaps:bigint;assertion_evidence_gaps:bigint;segment_evidence_gaps:bigint}>>(Prisma.sql`
 SELECT
 (SELECT COUNT(*) FROM "P0AFactAssertion" WHERE "presentationRole" IN ('PRIOR_YEAR_END','COMPARATIVE_PERIOD') AND "periodNature"='INSTANT' AND "periodStart"<>"periodEnd")::bigint instant_mismatch,
 (SELECT COUNT(*) FROM "P0AFactAssertion" WHERE "presentationRole"='COMPARATIVE_PERIOD' AND "periodNature"='DURATION' AND "periodStart">="periodEnd")::bigint duration_mismatch,
 (SELECT COUNT(*) FROM "P0AFactAssertion" a JOIN "P0AReportRevision" r ON r.id=a."reportRevisionId" WHERE a."presentationRole" IN ('PRIOR_YEAR_END','COMPARATIVE_PERIOD') AND a."periodEnd">=r."periodEnd")::bigint not_prior,
 (SELECT COUNT(*) FROM "DerivedMetricInput" i JOIN "DerivedMetricResult" r ON r.id=i."resultId" LEFT JOIN "P0AFactAssertion" a ON a.id=i."inputAssertionId" LEFT JOIN "DerivedMetricResult" ir ON ir.id=i."inputResultId" WHERE r."presentationRole"='COMPARATIVE_PERIOD' AND ((a.id IS NOT NULL AND (a."periodStart"<>r."periodStart" OR a."periodEnd"<>r."periodEnd")) OR (ir.id IS NOT NULL AND (ir."periodStart"<>r."periodStart" OR ir."periodEnd"<>r."periodEnd"))))::bigint mixed_derived_inputs,
 (SELECT COUNT(*) FROM "SegmentFact" f JOIN "SegmentDimension" s ON s.id=f."segmentId" WHERE f."presentationRole"='COMPARATIVE_PERIOD' AND (s."continuityKey" IS NULL OR s."continuityValidFrom">f."periodStart" OR s."continuityValidTo"<f."periodEnd"))::bigint segment_continuity_gaps,
 (SELECT COUNT(*) FROM "P0AFactAssertion" a WHERE a."presentationRole" IN ('PRIOR_YEAR_END','COMPARATIVE_PERIOD') AND NOT EXISTS(SELECT 1 FROM "P0AFactAssertionEvidence" e WHERE e."assertionId"=a.id))::bigint assertion_evidence_gaps,
 (SELECT COUNT(*) FROM "SegmentFact" f WHERE f."presentationRole"='COMPARATIVE_PERIOD' AND NOT EXISTS(SELECT 1 FROM "SegmentFactEvidence" e WHERE e."factId"=f.id))::bigint segment_evidence_gaps
 `);assert.deepEqual(temporal[0],{instant_mismatch:BigInt(0),duration_mismatch:BigInt(0),not_prior:BigInt(0),mixed_derived_inputs:BigInt(0),segment_continuity_gaps:BigInt(0),assertion_evidence_gaps:BigInt(0),segment_evidence_gaps:BigInt(0)});
 assert.equal(await prisma.phase7AExtractionRun.count(),3);assert.equal(await prisma.phase7AExtractionRun.count({where:{providerCalls:{not:0}}}),0);assert.equal(await prisma.dividendEvent.count(),3);
 for(const item of cases){const company=await prisma.company.findUniqueOrThrow({where:{ticker:item.ticker}});assert.ok(await prisma.p0AFactAssertion.count({where:{companyId:company.id,presentationRole:"PRIOR_YEAR_END"}})>0);assert.ok(await prisma.p0AFactAssertion.count({where:{companyId:company.id,presentationRole:"COMPARATIVE_PERIOD"}})>0);assert.ok(await prisma.segmentFact.count({where:{companyId:company.id,presentationRole:"COMPARATIVE_PERIOD"}})>0);}
 const report={acceptanceVersion:"PHASE7A_DATABASE_ACCEPTANCE_V1",database:{name:databaseName,engine:"PostgreSQL 16.4",disposable:true},counts:{beforePhase7A:baseline.counts,firstPersistence:first.counts,secondPersistence:second.counts},seedIdempotency:{passed:true,first:seed1.counts,second:seed2.counts},persistenceIdempotency:{passed:true,duplicateChecks:duplicates.map(r=>({check:r.check,duplicates:r.duplicates.toString()}))},temporalIdentity:{passed:true,checks:Object.fromEntries(Object.entries(temporal[0]).map(([k,v])=>[k,(v as bigint).toString()]))},frozenFingerprints:{before:baseline.frozenFingerprints,after:afterFrozen,passed:true},openAi:{calls:0,inputTokens:0,outputTokens:0,costUsd:"0.00000000"},productionSafety:{disposableOnly:true,railwayMutation:false,deployment:false,productionDatabase:false}};await writeJson(output,report);console.log(JSON.stringify(report,null,2));
}
async function main(){const [cmd,...a]=process.argv.slice(2);if(cmd==="snapshot"&&a[0])return snapshot(a[0]);if(cmd==="prepare"&&a[0])return prepare(a[0]);if(cmd==="persist"&&a[0]&&a[1]&&a[2])return persist(a[0] as Issuer,a[1],a[2]);if(cmd==="verify"&&a.length===6)return verify(a[0],a[1],a[2],a[3],a[4],a[5]);throw new Error(`Usage: ${basename(process.argv[1])} snapshot|prepare|persist|verify`);}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());
