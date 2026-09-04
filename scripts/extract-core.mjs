export const clamp01=n=>Math.max(0,Math.min(1,Number.isFinite(Number(n))?Number(n):0));
const array=v=>Array.isArray(v)?v:(v==null?[]:[v]);
const text=v=>typeof v==='string'?v.trim():(v==null?'':String(v).trim());
const upper=v=>text(v).toUpperCase();

export function normalizeDirection(v){
  const x=upper(v);return ['UP','DOWN','FLAT','MIXED','UNKNOWN'].includes(x)?x:'UNKNOWN';
}
export function normalizeFactType(v){
  const x=upper(v);return x==='INFERENCE'?'INFERENCE':'FACT';
}
export function normalizeParsed(x){
  if(!x||typeof x!=='object')return null;
  const rawItems=array(x.items??x.evidence??x.facts??x.claims);
  const items=rawItems.map(i=>({
    candidate_id:text(i?.candidate_id??i?.candidateId??i?.source_id??i?.sourceId??i?.id),
    fact_type:normalizeFactType(i?.fact_type??i?.factType??i?.type),
    claim:text(i?.claim??i?.fact??i?.statement??i?.text),
    direction:normalizeDirection(i?.direction??i?.impact??i?.trend),
    relevance:clamp01(i?.relevance??i?.confidence??i?.score??1),
    contradiction:Boolean(i?.contradiction??i?.is_contradiction??i?.isContradiction??false),
    why_upstream:text(i?.why_upstream??i?.whyUpstream??i?.rationale??'')
  })).filter(i=>i.candidate_id&&i.claim);
  return {
    summary:text(x.summary??x.overview??x.conclusion??x.analysis??''),
    items,
    expected_next:array(x.expected_next??x.expectedNext??x.next_checks??x.nextChecks).map(text).filter(Boolean),
    invalidation:array(x.invalidation??x.invalidations??x.invalidate_if??x.invalidateIf).map(text).filter(Boolean)
  };
}
export function validParsed(x){
  return Boolean(x&&typeof x.summary==='string'&&Array.isArray(x.items)&&Array.isArray(x.expected_next)&&Array.isArray(x.invalidation));
}

function stripFence(s){
  let x=text(s).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const a=x.indexOf('{'),b=x.lastIndexOf('}');if(a>=0&&b>a)x=x.slice(a,b+1);return x;
}
function removeTrailingCommas(s){return s.replace(/,\s*([}\]])/g,'$1')}
function balanceClosers(s){
  let inString=false,escape=false;const stack=[];
  for(const ch of s){
    if(inString){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')inString=false;continue}
    if(ch==='"'){inString=true;continue}
    if(ch==='{')stack.push('}');else if(ch==='[')stack.push(']');else if((ch==='}'||ch===']')&&stack.at(-1)===ch)stack.pop();
  }
  if(inString)return s;
  return s+[...stack].reverse().join('');
}
export function parseModelJson(raw){
  const base=stripFence(raw);const attempts=[base,removeTrailingCommas(base),balanceClosers(removeTrailingCommas(base))];let last;
  for(const candidate of [...new Set(attempts)]){
    try{return {value:JSON.parse(candidate),repair:'NONE'}}catch(e){last=e}
  }
  return {value:null,error:last||new Error('JSON_PARSE_FAILED'),raw:base};
}

export async function mapConcurrent(items,limit,worker){
  const out=new Array(items.length);let cursor=0;const n=Math.max(1,Math.min(Number(limit)||1,items.length||1));
  async function run(){while(true){const i=cursor++;if(i>=items.length)return;out[i]=await worker(items[i],i)}}
  await Promise.all(Array.from({length:n},()=>run()));return out;
}
