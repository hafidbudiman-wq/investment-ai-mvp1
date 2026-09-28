import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { parseFinancialDecimal } from "@/lib/financial/p0a/decimal";
import { createEvidence } from "@/lib/financial/p0a/evidence";
import { runP0ACompatiblePipeline } from "@/lib/financial/p0a/pipeline";
import { P0A_REQUIREMENT_BY_ID } from "@/lib/financial/p0a/requirements";
import type { P0AEvidence, P0AIssuerContext, P0ANativeObservation, P0APageToken, P0ARoutedPage } from "@/lib/financial/p0a/types";
import { runPhase6A } from "@/lib/financial/p0b/phase6a-pipeline";
import { PHASE6A_REQUIREMENTS } from "@/lib/financial/p0b/phase6a-registry";
import { runPhase6B } from "@/lib/financial/p0b/phase6b-pipeline";
import type { Phase6BSegmentFact } from "@/lib/financial/p0b/phase6b-types";
import type {
  Phase7ADerivedFact, Phase7ADividendDedup, Phase7APresentationRole,
  Phase7AReportedFact, Phase7AResult, Phase7ASegmentFact, Phase7AValidation,
} from "@/lib/financial/p0b/phase7a-types";

export const PHASE7A_MANIFEST_VERSION = "INVESTAI_PHASE7A_MULTIPERIOD_INTRADOC_V1";
export const PHASE7A_EXTRACTOR_VERSION = "phase7a-deterministic-v1";

const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const clean = (value: string): string => value.normalize("NFKC").replace(/\s+/g, " ").trim();
type Line = { y: number; text: string; tokens: P0APageToken[] };
type Num = { x: number; raw: string; decimal: string; token: P0APageToken };

function lines(page: P0ARoutedPage): Line[] {
  const sorted=[...page.tokens].sort((a,b)=>b.y-a.y||a.x-b.x);
  const out:Line[]=[];
  for(const token of sorted){
    const line=out.find(x=>Math.abs(x.y-token.y)<=1.25);
    if(line) line.tokens.push(token); else out.push({y:token.y,text:"",tokens:[token]});
  }
  for(const line of out){ line.tokens.sort((a,b)=>a.x-b.x); line.text=clean(line.tokens.map(t=>t.text).join(" ")); }
  return out.sort((a,b)=>b.y-a.y);
}
function nums(line:Line):Num[]{
  const out:Num[]=[];
  for(let i=0;i<line.tokens.length;i++){
    const token=line.tokens[i]; const parsed=parseFinancialDecimal(token.text); if(!parsed) continue;
    const prev=line.tokens[i-1], next=line.tokens[i+1];
    const wrapped=prev?.text==="("&&next?.text===")"&&Math.abs(prev.x+prev.width-token.x)<3;
    const raw=wrapped?`(${token.text})`:token.text;
    const decimal=wrapped&&!parsed.decimal.startsWith("-")?new Prisma.Decimal(parsed.decimal).negated().toFixed():parsed.decimal;
    out.push({x:token.x,raw,decimal,token});
  }
  return out;
}
function labelScore(window:string,label:string):number{
  const words=clean(label).toLowerCase().split(/\s+/).filter(w=>w.length>2&&!/^\d/.test(w)).slice(0,5);
  return words.reduce((n,w)=>n+(window.toLowerCase().includes(w)?1:0),0);
}
function findSibling(page:P0ARoutedPage, currentValue:string, rowLabel:string):{raw:string;decimal:string;line:Line}|null{
  const ls=lines(page); const candidates:Array<{score:number;index:number;matchIndex:number;line:Line;cells:Num[]}>=[];
  for(let i=0;i<ls.length;i++){
    const cells=nums(ls[i]); if(cells.length<2) continue;
    const matchIndex=cells.findIndex(c=>new Prisma.Decimal(c.decimal).eq(currentValue));
    if(matchIndex<0||matchIndex===cells.length-1) continue;
    const window=clean(ls.slice(Math.max(0,i-2),Math.min(ls.length,i+3)).map(x=>x.text).join(" "));
    candidates.push({score:labelScore(window,rowLabel),index:i,matchIndex,line:ls[i],cells});
  }
  candidates.sort((a,b)=>b.score-a.score||a.index-b.index);
  const chosen=candidates[0]; if(!chosen||chosen.score===0) return null;
  const sibling=chosen.cells[chosen.matchIndex+1];
  return sibling?{raw:sibling.raw,decimal:sibling.decimal,line:chosen.line}:null;
}
const MONTHS:Record<string,number>={januari:1,january:1,februari:2,february:2,maret:3,march:3,april:4,mei:5,may:5,juni:6,june:6,juli:7,july:7,agustus:8,august:8,september:9,oktober:10,october:10,november:11,desember:12,december:12};
function explicitDates(text:string):string[]{
  const out=new Set<string>();
  for(const m of text.matchAll(/\b(\d{1,2})\s+(Januari|January|Februari|February|Maret|March|April|Mei|May|Juni|June|Juli|July|Agustus|August|September|Oktober|October|November|Desember|December)\s+(20\d{2})\b/gi)){
    out.add(`${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2,"0")}-${m[1].padStart(2,"0")}`);
  }
  for(const m of text.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/gi)){
    out.add(`${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2,"0")}-${m[2].padStart(2,"0")}`);
  }
  return [...out];
}
function priorDuration(context:P0AIssuerContext,page:P0ARoutedPage){
  const priorYear=String(Number(context.periodEnd.slice(0,4))-1);
  if(!new RegExp(`\\b${priorYear}\\b`).test(page.text)) return null;
  const start=`${priorYear}${context.periodStart.slice(4)}`, end=`${priorYear}${context.periodEnd.slice(4)}`;
  return {start,end,type:context.periodType as P0AIssuerContext["periodType"]};
}
function priorInstant(context:P0AIssuerContext,page:P0ARoutedPage){
  const dates=explicitDates(page.text).filter(d=>d<context.periodEnd).sort();
  const preferred=dates.filter(d=>d.startsWith(String(Number(context.periodEnd.slice(0,4))-1))).at(-1);
  return preferred??dates.at(-1)??null;
}
function restatementMarker(text:string):string|null{
  const m=/(restated|reclassified|adjusted|represented|disajikan\s+kembali|direklasifikasi|disesuaikan)/i.exec(text);
  return m?clean(m[0]):null;
}
function sourceType(page:P0ARoutedPage){return page.sourceType??"NATIVE";}
function scope(context:P0AIssuerContext):"CONSOLIDATED"|"STANDALONE"|"UNKNOWN"{return context.consolidated===true?"CONSOLIDATED":context.consolidated===false?"STANDALONE":"UNKNOWN";}
function comparativeFact(args:{
  family:"P0A_REPORTED"|"PHASE6A_REPORTED"; requirementId:string; currentValue:string; currentRaw:string|null;
  currency:string; unitType:string; scale:string; periodNature:"INSTANT"|"DURATION"; evidence:P0AEvidence[];
  pages:P0ARoutedPage[]; context:P0AIssuerContext; documentSha256:string; read:number|null; mapping:number|null;
}):Phase7AReportedFact|null{
  const ev=args.evidence[0]; if(!ev) return null;
  const page=args.pages.find(p=>p.pageNumber===ev.pageNumber); if(!page) return null;
  const sibling=findSibling(page,args.currentValue,ev.rowLabel); if(!sibling) return null;
  let start:string,end:string,role:Phase7APresentationRole,label:string;
  if(args.periodNature==="INSTANT"){
    const instant=priorInstant(args.context,page); if(!instant) return null;
    start=instant; end=instant; role="PRIOR_YEAR_END"; label=instant;
  }else{
    const duration=priorDuration(args.context,page); if(!duration) return null;
    start=duration.start; end=duration.end; role="COMPARATIVE_PERIOD"; label=end.slice(0,4);
  }
  const snippet=clean(lines(page).filter(l=>Math.abs(l.y-sibling.line.y)<110).map(l=>l.text).join(" ")).slice(0,1800);
  const evidence=createEvidence({requirementId:args.requirementId,page,statement:ev.statement,table:ev.table,rowLabel:ev.rowLabel,columnLabel:label,rawValue:sibling.raw,snippet});
  const state=new Prisma.Decimal(sibling.decimal).isZero()?"ZERO":"VALUE";
  const temporalIdentityKey=sha([args.context.ticker,args.requirementId,start,end,args.context.periodType,args.periodNature,scope(args.context),args.currency,args.scale,args.documentSha256,role].join("|"));
  const assertionKey=sha([args.documentSha256,args.requirementId,start,end,args.periodNature,sibling.decimal,sibling.raw,evidence.evidenceHash].join("|"));
  return {temporalIdentityKey,assertionKey,requirementId:args.requirementId,family:args.family,state,decimalValue:sibling.decimal,rawValue:sibling.raw,currency:args.currency,unitType:args.unitType,scale:args.scale,period:{start,end,type:args.context.periodType,nature:args.periodNature},consolidationScope:scope(args.context),presentationRole:role,presentationMetadata:{periodColumnLabel:label,restatementMarker:restatementMarker(page.text)},sourceRevisionHash:args.documentSha256,extractionOrigin:sourceType(page),confidence:{read:args.read??(sourceType(page)==="OCR"?page.sourceMetadata?.numericMeanConfidence??0:1),mapping:args.mapping??0.995},evidence:[evidence]};
}

type SegmentAlias={code:string;type:"BUSINESS"|"RECONCILIATION";patterns:RegExp[]};
const SEGMENT_ALIASES:SegmentAlias[]=[
 {code:"NUTRITION_SPECIAL_FOODS",type:"BUSINESS",patterns:[/nutrition\s+and\s+special\s+foods/i]},
 {code:"FOOD_SEASONINGS",type:"BUSINESS",patterns:[/food\s+seasonings/i]},
 {code:"SNACK_FOODS",type:"BUSINESS",patterns:[/snack\s+foods/i]},
 {code:"EXPLORATION_PRODUCTION_OIL_GAS",type:"BUSINESS",patterns:[/exploration[\s\S]{0,40}?production[\s\S]{0,30}?oil\s+and\s+gas/i]},
 {code:"HOLDING_RELATED_OPERATIONS",type:"BUSINESS",patterns:[/holding\s+and\s+related\s+operations/i]},
 {code:"DISCONTINUED_OPERATIONS",type:"RECONCILIATION",patterns:[/discontinued\s+operations/i]},
 {code:"TWO_WHEELS",type:"BUSINESS",patterns:[/two\s+wheels(?:\s+segment)?/i,/segmen\s+roda\s+dua/i]},
 {code:"FOUR_WHEELS",type:"BUSINESS",patterns:[/four\s+wheels(?:\s+segment)?/i,/segmen\s+roda\s+empat/i]},
 {code:"OTHER_SEGMENTS",type:"BUSINESS",patterns:[/other\s+segments?/i,/segmen\s+lain-?lain/i]},
 {code:"NOODLES",type:"BUSINESS",patterns:[/noodles?\*?/i]},
 {code:"DAIRY",type:"BUSINESS",patterns:[/\bdairy\b/i]},{code:"BEVERAGES",type:"BUSINESS",patterns:[/\bbeverages?\b/i]},
 {code:"SERVICES",type:"BUSINESS",patterns:[/\bservices?\b/i]},{code:"POWER",type:"BUSINESS",patterns:[/\bpower\b/i]},
 {code:"TRADING",type:"BUSINESS",patterns:[/\btrading\b/i]},{code:"ELIMINATION",type:"RECONCILIATION",patterns:[/\belimination\b/i]},
 {code:"CONSOLIDATED_TOTAL",type:"RECONCILIATION",patterns:[/\bconsolidation\b/i,/\btotal\s+segments?\b/i,/\bjumlah\s+segmen\b/i,/^total$/i]},
];
function identifySegment(raw:string){for(const a of SEGMENT_ALIASES)for(const p of a.patterns){const m=p.exec(raw);if(m)return{sourceLabel:clean(m[0]),normalizedLabel:a.code,segmentType:a.type};}return null;}
type RowSpec={metricCode:"REVENUE"|"OPERATING_PROFIT";salesScope:"EXTERNAL"|"INTERSEGMENT"|"TOTAL"|null;label:string;anchors:RegExp[]};
const ROWS:RowSpec[]=[
 {metricCode:"OPERATING_PROFIT",salesScope:null,label:"Segment Income from Operations",anchors:[/laba\s+usaha\s+segmen/i,/segment\s+income\s+from\s+operations/i]},
 {metricCode:"REVENUE",salesScope:"INTERSEGMENT",label:"Inter-segment Sales",anchors:[/penjualan\s+antar\s+segmen/i,/inter-?segment\s+sales/i]},
 {metricCode:"REVENUE",salesScope:"TOTAL",label:"Total Segment Revenue",anchors:[/total\s+penjualan\s+neto/i,/total\s+net\s+sales/i,/jumlah\s+penjualan\s+dan\s+pendapatan\s+usaha\s+lainnya/i,/total\s+sales\s+and\s+other\s+operating\s+revenues/i]},
 {metricCode:"REVENUE",salesScope:"EXTERNAL",label:"External Revenue",anchors:[/penjualan\s+kepada[\s\S]{0,100}?pelanggan\s+eksternal/i,/sales\s+to\s+external[\s\S]{0,160}?customers/i,/penjualan\s+eksternal/i,/external\s+sales/i,/pendapatan\s+ekstern/i,/external\s+revenue/i]},
];
function rowSpec(ls:Line[],i:number):{spec:RowSpec;sourceLabel:string}|null{
  const source=[ls[i].text]; for(let c=i-1;c>=0&&source.length<7;c--){if(nums(ls[c]).length>=3)break;source.unshift(ls[c].text);}
  const w=clean(source.join(" ")); const matches=ROWS.flatMap(spec=>spec.anchors.map(a=>{const m=a.exec(w);return m?{spec,index:m.index,sourceLabel:clean(m[0])}:null})).filter((x):x is {spec:RowSpec;index:number;sourceLabel:string}=>!!x);
  return matches.sort((a,b)=>b.index-a.index)[0]??null;
}
function yearRow(ls:Line[],rowIndex:number,year:string):boolean{
 const row=ls[rowIndex]; const dates=ls.filter(l=>l.y>row.y+2&&l.y<row.y+260&&/\b(?:19|20)\d{2}\b/.test(l.text)).sort((a,b)=>a.y-b.y);
 return dates[0]?.text.includes(year)??false;
}
function headerGroups(page:P0ARoutedPage,header:Line,numeric:Num[]):string[]{
 const boundaries=numeric.map((c,i)=>i===numeric.length-1?Infinity:(c.x+numeric[i+1].x)/2);
 const lower=numeric.map((c,i)=>i===0?Math.max(0,c.x-45):boundaries[i-1]);
 const candidates=page.tokens.filter(t=>t.y>header.y+4&&t.y<header.y+105&&t.x+t.width/2>=lower[0]&&t.x+t.width/2<=numeric.at(-1)!.x+75);
 return numeric.map((_c,i)=>clean(candidates.filter(t=>{const center=t.x+t.width/2;return center>=lower[i]&&center<boundaries[i]}).sort((a,b)=>b.y-a.y||a.x-b.x).map(t=>t.text).join(" ")));
}
function comparativeSegments(pages:P0ARoutedPage[],context:P0AIssuerContext,documentSha256:string,current:Phase6BSegmentFact[],normalizedByIdentity:Map<string,string>):Phase7ASegmentFact[]{
 const priorYear=String(Number(context.periodEnd.slice(0,4))-1);
 const output:Phase7ASegmentFact[]=[];
 for(const page of pages.filter(p=>/segment|segmen/i.test(p.text)&&new RegExp(`\\b${priorYear}\\b`).test(p.text))){
   const ls=lines(page);
   const header=ls.find((l,i)=>nums(l).length>=3&&yearRow(ls,i,priorYear)&&rowSpec(ls,i)); if(!header) continue;
   const headers=headerGroups(page,header,nums(header)); const ids=headers.map(identifySegment); if(ids.some(x=>!x)) continue;
   for(let i=0;i<ls.length;i++){
     const numeric=nums(ls[i]); if(numeric.length<3||!yearRow(ls,i,priorYear)) continue;
     const rm=rowSpec(ls,i); if(!rm) continue;
     const duration=priorDuration(context,page); if(!duration) continue;
     for(let col=0;col<Math.min(numeric.length,ids.length);col++){
       const seg=ids[col]!; const currentFact=current.find(f=>f.metricCode===rm.spec.metricCode&&f.salesScope===rm.spec.salesScope&&normalizedByIdentity.get(f.segmentIdentityKey)===seg.normalizedLabel);
       if(!currentFact) continue;
       const n=numeric[col]; const snippet=clean(ls.slice(Math.max(0,i-4),Math.min(ls.length,i+5)).map(x=>x.text).join(" ")).slice(0,1800);
       const evidence=createEvidence({requirementId:rm.spec.metricCode==="REVENUE"?"SEGMENT_REVENUE":"SEGMENT_OPERATING_PROFIT",page,statement:"NOTE",table:"Segment Information",rowLabel:rm.sourceLabel,columnLabel:seg.sourceLabel,rawValue:n.raw,snippet});
       const continuityKey=sha([context.ticker,seg.normalizedLabel,seg.segmentType,PHASE7A_MANIFEST_VERSION].join("|"));
       const factKey=sha([documentSha256,duration.start,duration.end,continuityKey,rm.spec.metricCode,rm.spec.salesScope??"",n.decimal,n.raw,page.textHash].join("|"));
       output.push({factKey,continuityKey,normalizedLabel:seg.normalizedLabel,sourceLabel:seg.sourceLabel,segmentType:seg.segmentType,metricCode:rm.spec.metricCode,metricLabel:rm.spec.label,sourceMetricLabel:rm.sourceLabel,salesScope:rm.spec.salesScope,reportedValue:n.decimal,normalizedValue:new Prisma.Decimal(n.decimal).mul(context.documentScale).toFixed(),rawValue:n.raw,currency:context.currency,scale:context.documentScale,period:{...duration,nature:"DURATION"},consolidationScope:scope(context),presentationRole:"COMPARATIVE_PERIOD",presentationMetadata:{periodColumnLabel:priorYear,restatementMarker:restatementMarker(page.text)},sourceRevisionHash:documentSha256,extractionOrigin:sourceType(page),evidence:[evidence]});
     }
   }
 }
 const uniq=new Map(output.map(f=>[f.factKey,f])); return [...uniq.values()];
}
function phase6bNormMap(currentFacts:Phase6BSegmentFact[], phase6b:any):Map<string,string>{
 const m=new Map<string,string>(); for(const id of phase6b.segmentIdentities)m.set(id.identityKey,id.normalizedLabel); return m;
}

export async function runPhase7A(input:{bytes:Buffer;context:P0AIssuerContext}):Promise<Phase7AResult>{
 const p0a=await runP0ACompatiblePipeline({bytes:input.bytes,context:input.context});
 const phase6a=await runPhase6A({bytes:input.bytes,context:input.context,p0aResult:p0a});
 const phase6b=await runPhase6B({bytes:input.bytes,context:input.context,p0aResult:p0a});
 const documentSha256=sha(input.bytes); const reportedFacts:Phase7AReportedFact[]=[];
 for(const outcome of p0a.outcomes){
   const obs=outcome.reportedObservation as P0ANativeObservation|null; const req=P0A_REQUIREMENT_BY_ID.get(outcome.requirementId); if(!obs||!req||obs.decimalValue===null||!["VALUE","ZERO"].includes(obs.state)) continue;
   const fact=comparativeFact({family:"P0A_REPORTED",requirementId:outcome.requirementId,currentValue:obs.decimalValue,currentRaw:obs.rawValue,currency:obs.currency,unitType:obs.unitType,scale:obs.scale,periodNature:req.periodNature,evidence:obs.evidence,pages:p0a.routedPages,context:input.context,documentSha256,read:obs.readConfidence,mapping:obs.mappingConfidence});
   if(fact) reportedFacts.push(fact);
 }
 const phase6aReq=new Map(PHASE6A_REQUIREMENTS.map(r=>[r.requirementId,r]));
 for(const outcome of phase6a.outcomes.filter(o=>o.family==="REPORTED"&&o.value!==null&&["VALUE","ZERO"].includes(o.state))){
   const req=phase6aReq.get(outcome.requirementId); if(!req) continue;
   const fact=comparativeFact({family:"PHASE6A_REPORTED",requirementId:outcome.requirementId,currentValue:outcome.value!,currentRaw:outcome.rawValue,currency:outcome.currency!,unitType:outcome.unitType,scale:outcome.scale!,periodNature:req.periodNature,evidence:outcome.evidence,pages:p0a.routedPages,context:input.context,documentSha256,read:outcome.confidence.read,mapping:outcome.confidence.mapping});
   if(fact) reportedFacts.push(fact);
 }
 const dedupFacts=[...new Map(reportedFacts.map(f=>[f.temporalIdentityKey,f])).values()];
 const derivedFacts:Phase7ADerivedFact[]=[]; const validations:Phase7AValidation[]=[];
 const ocf=dedupFacts.find(f=>f.requirementId==="OCF_REPORTED"&&f.period.nature==="DURATION");
 const capex=dedupFacts.filter(f=>["CAPEX_PPE_CASH_REPORTED","CAPEX_INTANGIBLE_CASH_REPORTED"].includes(f.requirementId)&&f.period.nature==="DURATION");
 if(ocf&&capex.length){
   const compatible=capex.every(f=>f.period.start===ocf.period.start&&f.period.end===ocf.period.end&&f.currency===ocf.currency&&f.scale===ocf.scale&&f.consolidationScope===ocf.consolidationScope);
   validations.push({controlId:"DERIVED_INPUT_PERIOD_COMPATIBILITY",passed:compatible,state:compatible?"PASS":"INPUT_PERIOD_MISMATCH",reason:compatible?"All comparative FCF inputs share issuer period, scope, currency and scale.":"INPUT_PERIOD_MISMATCH"});
   if(compatible){
     const totalCapex=capex.reduce((v,f)=>v.plus(f.decimalValue),new Prisma.Decimal(0));
     const capexHash=sha([documentSha256,"CAPEX_TOTAL_CASH_CALCULATED",ocf.period.start,ocf.period.end,...capex.map(f=>f.temporalIdentityKey)].join("|"));
     derivedFacts.push({resultHash:capexHash,canonicalCode:"CAPEX_TOTAL_CASH_CALCULATED",formulaVersion:"1.0.0",expression:"SUM(ELIGIBLE_DISCLOSED_CASH_CAPEX_COMPONENTS)",state:totalCapex.isZero()?"ZERO":"VALUE",value:totalCapex.toFixed(),currency:ocf.currency,unitType:"DOCUMENT_CURRENCY",scale:ocf.scale,period:ocf.period,consolidationScope:ocf.consolidationScope,presentationRole:"COMPARATIVE_PERIOD",sourceRevisionHash:documentSha256,inputs:capex.map(f=>({inputIdentity:f.temporalIdentityKey,inputRole:f.requirementId,requirementId:f.requirementId,value:f.decimalValue,periodStart:f.period.start,periodEnd:f.period.end,currency:f.currency,scale:f.scale,scope:f.consolidationScope}))});
     const fcf= new Prisma.Decimal(ocf.decimalValue).plus(totalCapex); const fcfHash=sha([documentSha256,"FCF_CALCULATED",ocf.period.start,ocf.period.end,ocf.temporalIdentityKey,capexHash].join("|"));
     derivedFacts.push({resultHash:fcfHash,canonicalCode:"FCF_CALCULATED",formulaVersion:"1.0.0",expression:"OCF_REPORTED + SIGNED_CAPEX_TOTAL_CASH",state:fcf.isZero()?"ZERO":"VALUE",value:fcf.toFixed(),currency:ocf.currency,unitType:"DOCUMENT_CURRENCY",scale:ocf.scale,period:ocf.period,consolidationScope:ocf.consolidationScope,presentationRole:"COMPARATIVE_PERIOD",sourceRevisionHash:documentSha256,inputs:[{inputIdentity:ocf.temporalIdentityKey,inputRole:"OCF_REPORTED",requirementId:ocf.requirementId,value:ocf.decimalValue,periodStart:ocf.period.start,periodEnd:ocf.period.end,currency:ocf.currency,scale:ocf.scale,scope:ocf.consolidationScope},{inputIdentity:capexHash,inputRole:"SIGNED_CAPEX_TOTAL_CASH",requirementId:"CAPEX_TOTAL_CASH_CALCULATED",value:totalCapex.toFixed(),periodStart:ocf.period.start,periodEnd:ocf.period.end,currency:ocf.currency,scale:ocf.scale,scope:ocf.consolidationScope}]});
   }
 }else validations.push({controlId:"DERIVED_INPUT_PERIOD_COMPATIBILITY",passed:true,state:"PASS",reason:"No comparative FCF calculation attempted because exact required comparative inputs were not all source-resolved."});
 const norm=phase6bNormMap(phase6b.segmentFacts,phase6b);
 const segmentFacts=comparativeSegments(p0a.routedPages,input.context,documentSha256,phase6b.segmentFacts,norm);
 const dividendDedup:Phase7ADividendDedup[]=phase6b.dividendEvents.map(event=>{
   const economicEventKey=sha([input.context.ticker,event.eventType,event.sourceProfitPeriod.start??"",event.sourceProfitPeriod.end??"",event.dates.approval??event.dates.declaration??"",event.total?.normalizedValue??"",event.total?.currency??"",event.perShare?.normalizedValue??"",event.perShare?.currency??"",event.recipientScope,event.shareClass??""].join("|"));
   const duplicateCanonicalEvents=phase6b.dividendEvents.filter(other=>sha([input.context.ticker,other.eventType,other.sourceProfitPeriod.start??"",other.sourceProfitPeriod.end??"",other.dates.approval??other.dates.declaration??"",other.total?.normalizedValue??"",other.total?.currency??"",other.perShare?.normalizedValue??"",other.perShare?.currency??"",other.recipientScope,other.shareClass??""].join("|"))===economicEventKey).length-1;
   return {economicEventKey,canonicalEventKey:event.eventKey,evidenceOccurrences:event.evidence.length,distinctEvidencePages:[...new Set(event.evidence.map(x=>x.evidence.pageNumber))].sort((a,b)=>a-b),duplicateCanonicalEvents,passed:duplicateCanonicalEvents===0};
 });
 validations.push({controlId:"DIVIDEND_SAME_REPORT_DEDUP",passed:dividendDedup.every(x=>x.passed),state:dividendDedup.every(x=>x.passed)?"PASS":"CONFLICT",reason:"Economic event identity excludes disclosure-page identity; multiple evidence occurrences resolve to one canonical event."});
 const currentIds=new Set(p0a.outcomes.map(o=>{const obs=o.reportedObservation as P0ANativeObservation|null;return obs?sha([o.requirementId,obs.period.start,obs.period.end].join("|")):"";}));
 const temporalConflicts=dedupFacts.filter(f=>currentIds.has(sha([f.requirementId,f.period.start,f.period.end].join("|")))).map(f=>`CURRENT_COMPARATIVE_IDENTITY_COLLISION:${f.requirementId}`);
 validations.push({controlId:"CURRENT_COMPARATIVE_TEMPORAL_SEPARATION",passed:temporalConflicts.length===0,state:temporalConflicts.length?"CONFLICT":"PASS",reason:temporalConflicts.length?"A comparative fact reused a current accounting period.":"Current and comparative accounting periods are distinct by semantic identity."});
 const comparativePeriods=[...new Map([...dedupFacts.map(f=>[`${f.period.start}|${f.period.end}|${f.presentationRole}`,{start:f.period.start,end:f.period.end,type:f.period.type,role:f.presentationRole}]),...segmentFacts.map(f=>[`${f.period.start}|${f.period.end}|${f.presentationRole}`,{start:f.period.start,end:f.period.end,type:f.period.type,role:f.presentationRole}])]).values()];
 const selectedPages=[...new Set([...dedupFacts.flatMap(f=>f.evidence.map(e=>e.pageNumber)),...segmentFacts.flatMap(f=>f.evidence.map(e=>e.pageNumber)),...phase6b.dividendEvents.flatMap(e=>e.evidence.map(x=>x.evidence.pageNumber))])].sort((a,b)=>a-b);
 const p0aFp=sha(JSON.stringify(p0a.outcomes.map(o=>({id:o.requirementId,state:o.state,value:o.reportedObservation?.decimalValue??null,evidence:o.reportedObservation?.evidence.map(e=>e.evidenceHash)??[]}))));
 const p6aFp=sha(JSON.stringify(phase6a.outcomes.map(o=>({id:o.requirementId,state:o.state,value:o.value,fact:o.factIdentity}))));
 const runIdentity=sha(JSON.stringify({documentSha256,context:input.context,manifest:PHASE7A_MANIFEST_VERSION,extractor:PHASE7A_EXTRACTOR_VERSION,reported:dedupFacts.map(f=>f.temporalIdentityKey).sort(),derived:derivedFacts.map(f=>f.resultHash).sort(),segments:segmentFacts.map(f=>f.factKey).sort(),events:dividendDedup.map(e=>e.economicEventKey).sort()}));
 return {manifestVersion:PHASE7A_MANIFEST_VERSION,extractorVersion:PHASE7A_EXTRACTOR_VERSION,context:input.context,documentSha256,currentPeriod:{start:input.context.periodStart,end:input.context.periodEnd,type:input.context.periodType},comparativePeriods,reportedFacts:dedupFacts,derivedFacts,segmentFacts,dividendDedup,validations,temporalConflicts,selectedPages,p0a:{currentOutcomeFingerprint:p0aFp,ocrPages:p0a.ocrUsage.ocrPages,reusedOcrPages:p0a.ocrUsage.reusedOcrPages,versions:p0a.versions},phase6a:{currentRunIdentity:phase6a.runIdentity,outcomeFingerprint:p6aFp},phase6b:{currentRunIdentity:phase6b.runIdentity,eventCount:phase6b.dividendEvents.length,segmentFactCount:phase6b.segmentFacts.length},providerUsage:{providerCalls:0,inputTokens:0,outputTokens:0,costUsd:"0.00000000"},runIdentity};
}
