import crypto from 'node:crypto';

const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const canonicalUrl=u=>{try{const x=new URL(u);return `${x.hostname.replace(/^www\./,'')}${x.pathname}`.replace(/\/$/,'').toLowerCase()}catch{return String(u||'').split(/[?#]/)[0].toLowerCase()}};
const iso=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t).toISOString():null};
const hours=(a,b)=>Math.max(0,(Date.parse(b)-Date.parse(a))/36e5);
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,24);

export function evidenceKey(e){
  const url=canonicalUrl(e?.source_url);const claim=norm(e?.claim).slice(0,220);
  return hash(`${e?.phase||''}|${e?.signal||''}|${url||claim}`);
}
export function crediblePublishedAt(e){
  const p=iso(e?.published_at),r=iso(e?.retrieved_at);if(!p)return null;
  // Old web-rescue rows used retrieval time as publication time. Never treat that as source publication time.
  if(e?.engine==='openrouter_web_fallback'&&r&&Math.abs(Date.parse(p)-Date.parse(r))<120000)return null;
  return p;
}
export function mergeEvidenceMemory(current=[],previous=[],policy={},nowIso=new Date().toISOString()){
  const cfg=policy.evidence_memory||{},ttl=cfg.ttl_hours||{LEAD:168,CONFIRM:72,LAG:336},half=cfg.half_life_hours||{LEAD:72,CONFIRM:36,LAG:168},min=Number(cfg.min_weight??.25),max=Number(cfg.max_items_per_mechanism||96);
  const prior=new Map((previous||[]).map(e=>[e.evidence_key||evidenceKey(e),e]));const out=new Map();
  for(const raw of current||[]){
    const key=evidenceKey(raw),old=prior.get(key),first=iso(old?.first_seen_at)||iso(old?.retrieved_at)||iso(raw?.retrieved_at)||nowIso;
    const e={...raw,evidence_key:key,published_at:crediblePublishedAt(raw),first_seen_at:first,last_seen_at:nowIso,memory_weight:1,memory_status:'OBSERVED',memory_age_hours:0};out.set(key,e);
  }
  for(const raw of previous||[]){
    const key=raw.evidence_key||evidenceKey(raw);if(out.has(key)||raw?.contradiction)continue;
    const last=iso(raw.last_seen_at)||iso(raw.retrieved_at)||iso(raw.first_seen_at);if(!last)continue;const age=hours(last,nowIso),phase=raw.phase||'LEAD',maxAge=Number(ttl[phase]??ttl.LEAD??168);if(age>maxAge)continue;
    const h=Math.max(1,Number(half[phase]??half.LEAD??72)),weight=Math.pow(.5,age/h);if(weight<min)continue;
    out.set(key,{...raw,evidence_key:key,published_at:crediblePublishedAt(raw),first_seen_at:iso(raw.first_seen_at)||last,last_seen_at:last,memory_weight:+weight.toFixed(4),memory_status:'CARRIED',memory_age_hours:+age.toFixed(2)});
  }
  return [...out.values()].sort((a,b)=>(Number(b.memory_weight||0)-Number(a.memory_weight||0))||(Number(b.source_grade||0)-Number(a.source_grade||0))).slice(0,max);
}
