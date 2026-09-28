import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runPhase7A } from "../../lib/financial/p0b/phase7a-pipeline";
import type { P0AIssuerContext } from "../../lib/financial/p0a/types";

test("Phase 7A implementation remains generic, forward-only and additive", async()=>{
 const root=process.cwd();
 const sources=await Promise.all(["lib/financial/p0b/phase7a-pipeline.ts","lib/financial/p0b/phase7a-persistence.ts"].map(p=>readFile(join(root,p),"utf8")));
 assert.doesNotMatch(sources.join("\n"),/ICBP|MEDC|DRMA|Indofood|Medco|Dharma\s+Polimetal/i);
 const migration=await readFile(join(root,"prisma/migrations/20260928130000_phase7a_multiperiod_intradoc/migration.sql"),"utf8");
 assert.doesNotMatch(migration,/DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN/i);
 assert.match(migration,/temporalIdentityKey/);
 assert.match(migration,/Phase7AExtractionRun/);
 assert.match(migration,/periodStart_periodEnd/);
});

const cases:Array<{ticker:string;env:string;context:P0AIssuerContext;ocr:number[]}>= [
 {ticker:"ICBP",env:"P0A_ICBP_PDF_PATH",context:{ticker:"ICBP",issuerType:"LISTED_COMMON_EQUITY",accountingModel:"NON_FINANCIAL",consolidated:true,audited:false,periodStart:"2025-01-01",periodEnd:"2025-06-30",periodType:"H1",currency:"IDR",documentScale:"1000000"},ocr:[]},
 {ticker:"MEDC",env:"P0A_MEDC_PDF_PATH",context:{ticker:"MEDC",issuerType:"LISTED_COMMON_EQUITY",accountingModel:"NON_FINANCIAL",consolidated:true,audited:false,periodStart:"2025-01-01",periodEnd:"2025-06-30",periodType:"H1",currency:"USD",documentScale:"1"},ocr:[]},
 {ticker:"DRMA",env:"P0A_DRMA_PDF_PATH",context:{ticker:"DRMA",issuerType:"LISTED_COMMON_EQUITY",accountingModel:"NON_FINANCIAL",consolidated:true,audited:true,periodStart:"2025-01-01",periodEnd:"2025-12-31",periodType:"FY",currency:"IDR",documentScale:"1"},ocr:[4,5,6,7]},
];
for(const item of cases){
 const path=process.env[item.env];
 test(`${item.ticker} intra-document comparative truth`,{skip:!path},async()=>{
  const bytes=await readFile(path!);
  const first=await runPhase7A({bytes,context:item.context});
  const second=await runPhase7A({bytes,context:item.context});
  assert.deepEqual(second,first);
  assert.deepEqual(first.p0a.ocrPages,item.ocr);
  assert.equal(first.providerUsage.providerCalls,0);
  assert.equal(first.providerUsage.costUsd,"0.00000000");
  assert.ok(first.reportedFacts.some(f=>f.period.nature==="INSTANT"),"at least one instant comparative fact");
  assert.ok(first.reportedFacts.some(f=>f.period.nature==="DURATION"),"at least one duration comparative fact");
  assert.ok(first.reportedFacts.every(f=>f.period.end<item.context.periodEnd));
  assert.ok(first.reportedFacts.every(f=>f.evidence.length>0&&f.evidence.every(e=>e.evidenceHash&&e.locatorHash&&e.snippetHash)));
  assert.ok(first.reportedFacts.every(f=>f.presentationRole==="COMPARATIVE_PERIOD"||f.presentationRole==="PRIOR_YEAR_END"));
  assert.equal(first.temporalConflicts.length,0);
  assert.ok(first.validations.find(v=>v.controlId==="CURRENT_COMPARATIVE_TEMPORAL_SEPARATION")?.passed);
  assert.ok(first.dividendDedup.length>=1);
  assert.ok(first.dividendDedup.every(d=>d.passed&&d.duplicateCanonicalEvents===0));
  assert.ok(first.segmentFacts.length>0,"frozen reports disclose comparative segment revenue");
  assert.ok(first.segmentFacts.every(f=>f.period.end<item.context.periodEnd&&f.presentationRole==="COMPARATIVE_PERIOD"&&f.evidence.length>0));
  assert.equal(new Set(first.reportedFacts.map(f=>f.temporalIdentityKey)).size,first.reportedFacts.length);
  assert.equal(new Set(first.segmentFacts.map(f=>f.factKey)).size,first.segmentFacts.length);
 });
}
