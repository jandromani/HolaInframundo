import fs from 'node:fs/promises';

const read=async(p,f)=>JSON.parse(await fs.readFile(p,'utf8').catch(()=>JSON.stringify(f)));
const WINDOW=await read('data/event-window.json',{groups:[]});
const CURRENT=await read('data/current.json',{mechanisms:{}});
const PATH='data/window-research.json';
const RESEARCH=await read(PATH,{version:'1.0.0',facts:[]});
const now=new Date();
const MAX_LIVE_AGE_HOURS=168;
const ids=[...new Set((WINDOW.groups||[]).flatMap(g=>g.mechanisms||[]))];
const groupById=Object.fromEntries((WINDOW.groups||[]).flatMap(g=>(g.mechanisms||[]).map(id=>[id,g])));
const escId=s=>String(s||'').replace(/[^A-Za-z0-9_-]+/g,'_').slice(0,60);
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const grade=e=>e?.official||Number(e?.source_grade)>=.95?'A':Number(e?.source_grade)>=.75?'B+':Number(e?.source_grade)>=.55?'B':'C';
const published=e=>e?.published_at||e?.observed_at||e?.retrieved_at||CURRENT.updated_at||now.toISOString();
const seenAt=e=>e?.last_seen_at||e?.retrieved_at||CURRENT.updated_at||now.toISOString();
const key=e=>e?.evidence_key||`${e?.source_url||''}|${e?.claim||''}`;

function effect(e){
  if(e?.contradiction===true)return'CONTRADICTS';
  const d=String(e?.direction||'').toUpperCase();
  if(d==='UP'||d==='CONFIRM'||d==='POSITIVE')return'SUPPORTS';
  if(d==='DOWN'||d==='NEGATIVE')return'CONTRADICTS';
  return'OBSERVES';
}
function rowsFor(id){
  const m=CURRENT.mechanisms?.[id];if(!m)return[];
  const all=[...(m.observed_evidence||[]),...(m.verified||[]),...(m.evidence||[])];
  const seen=new Set(),out=[];
  for(const e of all){
    if(!e?.claim||!e?.source_url)continue;
    const k=key(e);if(seen.has(k))continue;seen.add(k);
    const ts=Date.parse(published(e));
    const ageHours=Number.isFinite(ts)?(now.getTime()-ts)/36e5:Infinity;
    if(ageHours<0||ageHours>MAX_LIVE_AGE_HOURS)continue;
    out.push({e,t:ts||0,ageHours});
  }
  out.sort((a,b)=>b.t-a.t);
  return out.slice(0,2).map(({e,ageHours})=>({
    id:`LIVE_${escId(id)}_${escId(e.evidence_key||String(key(e)).slice(-18))}`,
    lane:groupById[id]?.label||'PIPELINE',
    status:'PIPELINE_EVIDENCE',
    thesis_effect:effect(e),
    observed_at:published(e),
    seen_at:seenAt(e),
    age_hours:Number(ageHours.toFixed(1)),
    title:`${m.label||id} · ${e.signal||e.phase||'evidencia'}`,
    claim:clean(e.claim),
    strength:grade(e),
    source_type:e.official?'PIPELINE_OFFICIAL':'PIPELINE_SOURCE',
    refresh_hours:e.official?72:36,
    source:{publisher:clean(e.source_name||e.source_domain||'pipeline source'),url:e.source_url},
    mechanism_id:id,
    signal:e.signal||null,
    phase:e.phase||null,
    direction:e.direction||null,
    contradiction:Boolean(e.contradiction),
    evidence_key:e.evidence_key||null,
    source_grade:Number.isFinite(Number(e.source_grade))?Number(e.source_grade):null,
    verifier:m.verifier?.verdict||null
  }));
}

const liveFacts=ids.flatMap(rowsFor).sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at)).slice(0,16);
const byEffect=liveFacts.reduce((o,x)=>(o[x.thesis_effect]=(o[x.thesis_effect]||0)+1,o),{});
const next={...RESEARCH,version:'1.4.0',live_generated_at:now.toISOString(),live_run_id:CURRENT.run_id||null,live_policy:{max_age_hours:MAX_LIVE_AGE_HOURS,date_basis:'published_at_first'},live_summary:{points:liveFacts.length,mechanisms_covered:new Set(liveFacts.map(x=>x.mechanism_id)).size,by_effect:byEffect},live_facts:liveFacts};
await fs.writeFile(PATH,JSON.stringify(next,null,2)+'\n');
console.log(`window research refresh: ${liveFacts.length} publication-dated live facts across ${next.live_summary.mechanisms_covered} mechanisms · ${JSON.stringify(byEffect)}`);
