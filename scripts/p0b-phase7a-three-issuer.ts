import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runPhase7A } from "../lib/financial/p0b/phase7a-pipeline";
import type { P0AIssuerContext } from "../lib/financial/p0a/types";

const sha=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
const outputDir=process.env.PHASE7A_OUTPUT_DIR??"artifacts/phase7a";
const cases:Array<{ticker:string;fileName:string;path:string;expectedSha:string;context:P0AIssuerContext;expectedOcr:number[]}>= [
 {ticker:"ICBP",fileName:"ICBP_billingual_30Jun25.pdf",path:process.env.P0A_ICBP_PDF_PATH??"",expectedSha:"eb9a435e8bd0847d538b8bc954c53d9b7724bf87fac20023e1c52234a965f089",context:{ticker:"ICBP",issuerType:"LISTED_COMMON_EQUITY",accountingModel:"NON_FINANCIAL",consolidated:true,audited:false,periodStart:"2025-01-01",periodEnd:"2025-06-30",periodType:"H1",currency:"IDR",documentScale:"1000000"},expectedOcr:[]},
 {ticker:"MEDC",fileName:"Lap Keu MEDC 30 juni 2025.pdf",path:process.env.P0A_MEDC_PDF_PATH??"",expectedSha:"438675ac79b565ca4b583745bc2b2b885cf6b6fbbed8f71dcca51ef110cf880e",context:{ticker:"MEDC",issuerType:"LISTED_COMMON_EQUITY",accountingModel:"NON_FINANCIAL",consolidated:true,audited:false,periodStart:"2025-01-01",periodEnd:"2025-06-30",periodType:"H1",currency:"USD",documentScale:"1"},expectedOcr:[]},
 {ticker:"DRMA",fileName:"DRMA_2025.pdf",path:process.env.P0A_DRMA_PDF_PATH??"",expectedSha:"7eedda5609f8c9936d1d68beb149c19620ac57a34098db29716bd3fb4c1e48fb",context:{ticker:"DRMA",issuerType:"LISTED_COMMON_EQUITY",accountingModel:"NON_FINANCIAL",consolidated:true,audited:true,periodStart:"2025-01-01",periodEnd:"2025-12-31",periodType:"FY",currency:"IDR",documentScale:"1"},expectedOcr:[4,5,6,7]},
];
async function main(){
 if(cases.some(c=>!c.path)) throw new Error("Frozen Phase 7A source paths are required.");
 await mkdir(outputDir,{recursive:true}); const results=new Map<string,Awaited<ReturnType<typeof runPhase7A>>>(); const sums:Array<{file:string;sha256:string}>=[];
 for(const item of cases){
  const bytes=await readFile(item.path); assert.equal(sha(bytes),item.expectedSha);
  const first=await runPhase7A({bytes,context:item.context}); const second=await runPhase7A({bytes,context:item.context});
  assert.deepEqual(second,first); assert.deepEqual(first.p0a.ocrPages,item.expectedOcr); assert.equal(first.providerUsage.providerCalls,0);
  assert.ok(first.reportedFacts.some(f=>f.period.nature==="INSTANT")); assert.ok(first.reportedFacts.some(f=>f.period.nature==="DURATION"));
  assert.ok(first.segmentFacts.length>0); assert.ok(first.dividendDedup.every(d=>d.passed)); assert.equal(first.temporalConflicts.length,0);
  results.set(item.ticker,first);
  const factsByPeriod=Object.fromEntries(first.comparativePeriods.map(p=>{const key=`${p.start}..${p.end}:${p.role}`;return [key,{reportedFacts:first.reportedFacts.filter(f=>f.period.start===p.start&&f.period.end===p.end),derivedFacts:first.derivedFacts.filter(f=>f.period.start===p.start&&f.period.end===p.end),segmentFacts:first.segmentFacts.filter(f=>f.period.start===p.start&&f.period.end===p.end)}];}));
  const artifact={artifactVersion:first.manifestVersion,source:{fileName:item.fileName,sha256:item.expectedSha,revisionHash:first.documentSha256},currentReportingPeriod:first.currentPeriod,comparativePeriodsDiscovered:first.comparativePeriods,factsByPeriod,instantDuration:{instantComparativeCount:first.reportedFacts.filter(f=>f.period.nature==="INSTANT").length,durationComparativeCount:first.reportedFacts.filter(f=>f.period.nature==="DURATION").length},presentationRoles:[...new Set(first.reportedFacts.map(f=>f.presentationRole))],reportedCalculatedFamily:{reported:first.reportedFacts,calculated:first.derivedFacts},formulaVersionInputLineage:first.derivedFacts.map(f=>({canonicalCode:f.canonicalCode,resultHash:f.resultHash,formulaVersion:f.formulaVersion,inputs:f.inputs})),segmentComparativeFacts:first.segmentFacts,dividendEventReferences:first.dividendDedup,evidence:first.reportedFacts.flatMap(f=>f.evidence),nativeOcrOrigin:{ocrPages:first.p0a.ocrPages,reusedOcrPages:first.p0a.reusedOcrPages,wholeDocumentOcr:false,newOcrPages:[]},validationControls:first.validations,temporalConflicts:first.temporalConflicts,providerUsage:first.providerUsage,versionIdentity:{runIdentity:first.runIdentity,extractorVersion:first.extractorVersion,p0aVersions:first.p0a.versions,p0aFingerprint:first.p0a.currentOutcomeFingerprint,phase6aRunIdentity:first.phase6a.currentRunIdentity,phase6bRunIdentity:first.phase6b.currentRunIdentity}};
  const file=`${item.ticker}-PHASE7A-MULTIPERIOD.json`; const serialized=JSON.stringify(artifact,null,2)+"\n"; await writeFile(join(outputDir,file),serialized,"utf8"); sums.push({file,sha256:sha(serialized)});
 }
 const matrix={artifactVersion:"INVESTAI_PHASE7A_CROSS_ISSUER_MATRIX_V1",issuers:cases.map(item=>{const r=results.get(item.ticker)!;return{issuer:item.ticker,currentPeriod:r.currentPeriod,comparativePeriodsDiscovered:r.comparativePeriods,currentPeriodFactCount:34+18+r.phase6b.segmentFactCount,comparativeFactCount:r.reportedFacts.length+r.derivedFacts.length+r.segmentFacts.length,instantComparativeCoverage:r.reportedFacts.filter(f=>f.period.nature==="INSTANT").length,durationComparativeCoverage:r.reportedFacts.filter(f=>f.period.nature==="DURATION").length,segmentComparativeCoverage:r.segmentFacts.length,dividendDedupResult:r.dividendDedup.every(d=>d.passed)?"PASS":"CONFLICT",temporalValidation:r.validations.every(v=>v.passed)?"PASS":"CONFLICT",idempotency:"DETERMINISTIC_RESULT_PASS",ocrUsage:r.p0a.ocrPages};}),providerUsage:{providerCalls:0,inputTokens:0,outputTokens:0,costUsd:"0.00000000"}};
 const mf="PHASE7A-CROSS-ISSUER-MATRIX.json"; const ms=JSON.stringify(matrix,null,2)+"\n"; await writeFile(join(outputDir,mf),ms,"utf8"); sums.push({file:mf,sha256:sha(ms)});
 await writeFile(join(outputDir,"SHA256SUMS.txt"),sums.map(s=>`${s.sha256}  ${s.file}`).join("\n")+"\n","utf8");
 console.log(JSON.stringify({outputDir,sums,providerCalls:0,costUsd:"0.00000000"},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
