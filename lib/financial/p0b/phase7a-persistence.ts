import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PHASE6A_FORMULA_BY_CODE } from "@/lib/financial/p0b/phase6a-registry";
import type { P0AEvidence } from "@/lib/financial/p0a/types";
import type { Phase7AResult } from "@/lib/financial/p0b/phase7a-types";

const sha=(value:string):string=>createHash("sha256").update(value).digest("hex");
const json=(value:unknown):Prisma.InputJsonValue=>value as Prisma.InputJsonValue;
const date=(v:string)=>new Date(`${v}T00:00:00.000Z`);

export async function persistPhase7A(client:PrismaClient,input:{documentId:string;companyId:string;reportRevisionId:string;result:Phase7AResult}){
 return client.$transaction(async tx=>{
  const run=await tx.phase7AExtractionRun.upsert({
   where:{completeIdentityHash:input.result.runIdentity},
   create:{companyId:input.companyId,documentId:input.documentId,reportRevisionId:input.reportRevisionId,manifestVersion:input.result.manifestVersion,extractorVersion:input.result.extractorVersion,completeIdentityHash:input.result.runIdentity,sourceRevisionHash:input.result.documentSha256,currentPeriod:json(input.result.currentPeriod),comparativePeriods:json(input.result.comparativePeriods),selectedPages:json(input.result.selectedPages),validationSummary:json(input.result.validations),status:"SUCCEEDED",providerCalls:0,inputTokens:0,outputTokens:0,estimatedCostUsd:new Prisma.Decimal(0),completedAt:new Date()},
   update:{},
  });
  const pages=await tx.p0ADocumentPage.findMany({where:{documentId:input.documentId},select:{id:true,pageNumber:true}});
  const pageIds=new Map(pages.map(p=>[p.pageNumber,p.id]));
  const evidenceIds=new Map<string,string>();
  const persistEvidence=async(e:P0AEvidence)=>{
   const evidenceHash=e.evidenceHash??sha([input.documentId,e.locatorHash,e.snippetHash].join("|"));
   if(evidenceIds.has(evidenceHash)) return evidenceIds.get(evidenceHash)!;
   const stored=await tx.p0AFactEvidence.upsert({where:{evidenceHash},create:{documentId:input.documentId,pageId:pageIds.get(e.pageNumber),evidenceHash,pageNumber:e.pageNumber,printedPageLabel:e.printedPageLabel,statement:e.statement,tableName:e.table,rowLabel:e.rowLabel,columnLabel:e.columnLabel,rawValue:e.rawValue,snippet:e.snippet,snippetHash:e.snippetHash,locatorHash:e.locatorHash,rowIndex:e.rowIndex,columnIndex:e.columnIndex},update:{}});
   evidenceIds.set(evidenceHash,stored.id); return stored.id;
  };
  const assertionIds=new Map<string,string>();
  for(const fact of input.result.reportedFacts){
   const stored=await tx.p0AFactAssertion.upsert({
    where:{temporalIdentityKey:fact.temporalIdentityKey},
    create:{companyId:input.companyId,reportRevisionId:input.reportRevisionId,requirementId:fact.requirementId,definitionVersion:input.result.manifestVersion,assertionKey:fact.assertionKey,temporalIdentityKey:fact.temporalIdentityKey,periodStart:date(fact.period.start),periodEnd:date(fact.period.end),periodType:fact.period.type,periodNature:fact.period.nature,consolidationScope:fact.consolidationScope,presentationRole:fact.presentationRole,presentationMetadata:json(fact.presentationMetadata),sourceRevisionHash:fact.sourceRevisionHash,extractionOrigin:fact.extractionOrigin,origin:"REPORTED",rawLabel:fact.evidence[0]?.rowLabel,statement:fact.evidence[0]?.statement,readConfidence:new Prisma.Decimal(fact.confidence.read),mappingConfidence:new Prisma.Decimal(fact.confidence.mapping),valueState:fact.state,decimalValue:new Prisma.Decimal(fact.decimalValue),rawValue:fact.rawValue,currency:fact.currency,unitType:fact.unitType,scale:new Prisma.Decimal(fact.scale),lineageStatus:"COMPLETE",status:"SHADOW"},
    update:{},
   });
   assertionIds.set(fact.temporalIdentityKey,stored.id);
   for(const [ordinal,e] of fact.evidence.entries()){
    const evidenceId=await persistEvidence(e);
    await tx.p0AFactAssertionEvidence.upsert({where:{assertionId_evidenceId:{assertionId:stored.id,evidenceId}},create:{assertionId:stored.id,evidenceId,ordinal},update:{}});
   }
  }
  const p0bRun=await tx.p0BExtractionRun.findUniqueOrThrow({where:{completeIdentityHash:input.result.phase6a.currentRunIdentity}});
  const resultIds=new Map<string,string>();
  for(const derived of input.result.derivedFacts){
   if(derived.state==="INPUT_PERIOD_MISMATCH"||derived.value===null) continue;
   const formula=PHASE6A_FORMULA_BY_CODE.get(derived.canonicalCode);
   if(!formula) throw new Error(`Missing frozen formula definition for ${derived.canonicalCode}`);
   const definition=await tx.derivedMetricDefinition.upsert({where:{code_formulaVersion:{code:formula.code,formulaVersion:formula.formulaVersion}},create:{code:formula.code,formulaVersion:formula.formulaVersion,expression:formula.expression,namedInputs:json(formula.inputRoles),inclusionRules:json(formula.inclusionRules),exclusionRules:json(formula.exclusionRules),compatibilityRules:json(["same company","same period","same scope","same currency","same scale"]),outputUnit:derived.unitType},update:{}});
   const stored=await tx.derivedMetricResult.upsert({
    where:{resultHash:derived.resultHash},
    create:{definitionId:definition.id,runId:p0bRun.id,companyId:input.companyId,periodStart:date(derived.period.start),periodEnd:date(derived.period.end),periodType:derived.period.type,consolidationScope:derived.consolidationScope,currency:derived.currency,unitType:derived.unitType,scale:new Prisma.Decimal(derived.scale),decimalValue:new Prisma.Decimal(derived.value),calculationTimestamp:new Date(),calculationRunIdentity:input.result.runIdentity,engine:"InvestAI Decimal Engine",engineVersion:input.result.extractorVersion,validationStatus:"VALIDATED",presentationRole:derived.presentationRole,sourceRevisionHash:derived.sourceRevisionHash,resultHash:derived.resultHash},
    update:{},
   });
   resultIds.set(derived.resultHash,stored.id);
   for(const [ordinal,metricInput] of derived.inputs.entries()){
    const assertionId=assertionIds.get(metricInput.inputIdentity);
    const inputResultId=resultIds.get(metricInput.inputIdentity);
    if(!assertionId&&!inputResultId) throw new Error(`Unpersisted Phase 7A derived input ${metricInput.inputIdentity}`);
    await tx.derivedMetricInput.upsert({where:{resultId_ordinal:{resultId:stored.id,ordinal}},create:{resultId:stored.id,ordinal,inputRole:metricInput.inputRole,inputIdentity:metricInput.inputIdentity,inputAssertionId:assertionId,inputResultId,inputValue:new Prisma.Decimal(metricInput.value),inputExtractionOrigin:null,inputEvidenceHashes:json([]),revisionContextHash:input.result.runIdentity},update:{}});
   }
  }
  const phase6bRun=await tx.phase6BExtractionRun.findUniqueOrThrow({where:{completeIdentityHash:input.result.phase6b.currentRunIdentity}});
  for(const fact of input.result.segmentFacts){
   const segment=await tx.segmentDimension.findFirst({where:{companyId:input.companyId,normalizedLabel:fact.normalizedLabel,segmentType:fact.segmentType},orderBy:{createdAt:"asc"}});
   if(!segment) throw new Error(`Missing current segment identity for comparative continuity: ${fact.normalizedLabel}`);
   const currentFrom=segment.validFrom.toISOString().slice(0,10), currentTo=segment.validTo?.toISOString().slice(0,10)??input.result.context.periodEnd;
   await tx.segmentDimension.update({where:{id:segment.id},data:{continuityKey:fact.continuityKey,continuityValidFrom:date(fact.period.start<currentFrom?fact.period.start:currentFrom),continuityValidTo:date(fact.period.end>currentTo?fact.period.end:currentTo),presentationMetadata:json({sourceRevisionHash:fact.sourceRevisionHash,intraDocumentComparative:true})}});
   const stored=await tx.segmentFact.upsert({
    where:{factKey:fact.factKey},
    create:{runId:phase6bRun.id,companyId:input.companyId,documentId:input.documentId,reportRevisionId:input.reportRevisionId,segmentId:segment.id,factKey:fact.factKey,metricCode:fact.metricCode,metricLabel:fact.metricLabel,sourceMetricLabel:fact.sourceMetricLabel,periodColumn:fact.presentationMetadata.periodColumnLabel,salesScope:fact.salesScope,valueState:new Prisma.Decimal(fact.reportedValue).isZero()?"ZERO":"VALUE",reportedValue:new Prisma.Decimal(fact.reportedValue),normalizedValue:new Prisma.Decimal(fact.normalizedValue),rawValue:fact.rawValue,currency:fact.currency,unitType:"DOCUMENT_CURRENCY",scale:new Prisma.Decimal(fact.scale),periodStart:date(fact.period.start),periodEnd:date(fact.period.end),periodType:fact.period.type,consolidationScope:fact.consolidationScope,dimensionSchemaVersion:phase6bRun.dimensionSchemaVersion,dimensionHash:sha(JSON.stringify({continuityKey:fact.continuityKey,metric:fact.metricCode,salesScope:fact.salesScope})),definitionVersion:input.result.manifestVersion,sourceRevisionHash:fact.sourceRevisionHash,origin:"REPORTED",extractionOrigin:fact.extractionOrigin,readConfidence:fact.extractionOrigin==="OCR"?null:new Prisma.Decimal(1),mappingConfidence:new Prisma.Decimal("0.995"),validationStatus:"VALIDATED",presentationRole:fact.presentationRole,presentationMetadata:json(fact.presentationMetadata)},
    update:{},
   });
   for(const [ordinal,e] of fact.evidence.entries()){
    const evidenceId=await persistEvidence(e);
    await tx.segmentFactEvidence.upsert({where:{factId_evidenceId:{factId:stored.id,evidenceId}},create:{factId:stored.id,evidenceId,ordinal},update:{}});
   }
  }
  for(const check of input.result.validations){
   await tx.phase7AOutcome.upsert({where:{runId_code:{runId:run.id,code:check.controlId}},create:{runId:run.id,code:check.controlId,state:check.state,reason:check.reason,details:json({passed:check.passed})},update:{}});
  }
  return {runId:run.id,counts:{runs:await tx.phase7AExtractionRun.count({where:{completeIdentityHash:input.result.runIdentity}}),outcomes:await tx.phase7AOutcome.count({where:{runId:run.id}}),comparativeAssertions:await tx.p0AFactAssertion.count({where:{reportRevisionId:input.reportRevisionId,presentationRole:{in:["COMPARATIVE_PERIOD","PRIOR_YEAR_END"]}}}),comparativeDerived:await tx.derivedMetricResult.count({where:{runId:p0bRun.id,presentationRole:"COMPARATIVE_PERIOD"}}),comparativeSegmentFacts:await tx.segmentFact.count({where:{runId:phase6bRun.id,presentationRole:"COMPARATIVE_PERIOD"}})}};
 },{timeout:60_000});
}
