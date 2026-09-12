import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const read = async (path, fallback) => JSON.parse(await fs.readFile(path, 'utf8').catch(() => JSON.stringify(fallback)));
const WINDOW = await read('data/event-window.json', { groups: [] });
const HISTORY_PATH = 'data/history/window-snapshots.json';
const HISTORY = await read(HISTORY_PATH, { version: '1.1.0', window_id: WINDOW.id, snapshots: [] });
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,Number(x)||0));
const round=(x,d=1)=>Number(Number(x||0).toFixed(d));
const mean=xs=>{const a=xs.map(Number).filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:0};
const show=(sha,path,fallback={})=>{try{return JSON.parse(execFileSync('git',['show',`${sha}:${path}`],{encoding:'utf8',maxBuffer:20*1024*1024}))}catch{return fallback}};

const end = Date.parse(WINDOW.reference_end || '2026-09-12T00:00:00+02:00');
const start = Date.parse(WINDOW.reference_start || '2026-09-05T00:00:00+02:00');
const log = execFileSync('git',['log','--format=%H|%cI','--','data/current.json'],{encoding:'utf8',maxBuffer:10*1024*1024});
const commits = log.trim().split('\n').filter(Boolean).map(line=>{const [sha,date]=line.split('|');return {sha,date,t:Date.parse(date)}}).filter(x=>x.t>=start&&x.t<end).sort((a,b)=>a.t-b.t);

// Keep actual historical cadence but avoid bursts of near-identical commits.
const selected=[];
for(const c of commits){
  const prev=selected.at(-1);
  if(!prev || c.t-prev.t>=2*3600*1000) selected.push(c);
  else selected[selected.length-1]=c;
}

function buildSnapshot({sha,date}){
  const CURRENT=show(sha,'data/current.json',{mechanisms:{}});
  const INVESTMENT=show(sha,'data/investment-layer.json',{strategies:{}});
  const MARKET=show(sha,'data/market.json',{metrics:{}});
  const PRICING=show(sha,'data/pricing-sensors.json',{observations:{}});
  const PROD=show(sha,'data/production-health.json',{});
  const strategy=id=>INVESTMENT.strategies?.[id]||{};
  const mechanism=id=>CURRENT.mechanisms?.[id]||null;
  const priced=(id,m)=>clamp(strategy(id)?.priced_in ?? m?.crowd?.priced_in);
  const symbols=id=>(strategy(id)?.top5||strategy(id)?.top_candidates||[]).map(x=>x.symbol).filter(Boolean);
  function mechanismRow(id){
    const m=mechanism(id); if(!m)return null;
    const s=strategy(id), causal=clamp(m.score), pricedIn=priced(id,m), gap=causal-pricedIn, delta=Number(m.score_delta||0);
    const returns=symbols(id).map(t=>Number(MARKET.metrics?.[t]?.ret20)).filter(Number.isFinite);
    const ret20=returns.length?mean(returns):null;
    const transmission=clamp(s.transmission_score), timing=clamp(s.timing_score), freshness=clamp(50+delta*3);
    let pressure=.46*causal+.20*transmission+.18*Math.max(0,gap)+.10*freshness+.06*timing;
    if(s.crowd?.block_chase)pressure-=8;
    return {id,label:m.label||id,state:m.state||'UNKNOWN',causal:round(causal),priced_in:round(pricedIn),gap:round(gap),delta:round(delta),transmission:round(transmission),timing:round(timing),pressure:round(clamp(pressure)),ret20:Number.isFinite(ret20)?round(ret20,2):null,symbols:symbols(id).slice(0,5),verifier:m.verifier?.verdict||null};
  }
  function groupSnapshot(g){
    const rows=(g.mechanisms||[]).map(mechanismRow).filter(Boolean).sort((a,b)=>b.pressure-a.pressure), focus=rows.slice(0,Math.min(2,rows.length));
    return {id:g.id,label:g.label,icon:g.icon||'⚙',pressure:round(mean(focus.map(x=>x.pressure))),causal:round(mean(focus.map(x=>x.causal))),priced_in:round(mean(focus.map(x=>x.priced_in))),gap:round(mean(focus.map(x=>x.gap))),ret20:focus.some(x=>Number.isFinite(x.ret20))?round(mean(focus.map(x=>x.ret20).filter(Number.isFinite)),2):null,leaders:rows.slice(0,4).map(x=>x.id)};
  }
  const obs=Object.values(PRICING.observations||{}), ok=obs.filter(x=>x?.status==='OK').length, warning=obs.filter(x=>x?.status&&x.status!=='OK').length;
  const confidence=obs.length?clamp(100*ok/obs.length):50;
  const degraded=obs.filter(x=>x?.status&&x.status!=='OK').map(x=>({name:x.source||x.metric||'sensor',status:x.status})).slice(0,12);
  const sensors={ok,warning,total:obs.length,confidence:round(confidence),degraded};
  const groups=(WINDOW.groups||[]).map(groupSnapshot);
  const ids=[...new Set((WINDOW.groups||[]).flatMap(g=>g.mechanisms||[]))];
  const mechanisms=Object.fromEntries(ids.map(id=>[id,mechanismRow(id)]).filter(([,v])=>v));
  const gp=mean(groups.map(g=>g.pressure)), gc=mean(groups.map(g=>g.causal)), gpi=mean(groups.map(g=>g.priced_in));
  const shock=clamp(gp-(100-sensors.confidence)*.12);
  const timestamp=CURRENT.updated_at||date;
  return {
    timestamp,window_id:WINDOW.id,run_id:CURRENT.run_id||`git_${sha.slice(0,10)}`,source_updated_at:CURRENT.updated_at||timestamp,
    provenance:{mode:'GIT_BACKFILL',commit:sha,comparable_formula:'window-snapshot-v1.1',note:'Reconstructed from repository state that existed at this commit; not a contemporaneous 3h Window Lab checkpoint.'},
    composite:{shock_pressure:round(shock),causal:round(gc),priced_in:round(gpi),gap:round(gc-gpi),sensor_confidence:round(sensors.confidence),delta_3h:0,delta_semantic:0},
    groups,mechanisms,sensors,production:{status:PROD.status||'HISTORICAL',judge:PROD.judge?.status||'HISTORICAL'},
    judge:{model:'historical-git-backfill',semantic_pressure:round(shock),confidence:round(sensors.confidence),direction:'STABLE',headline:'Referencia histórica reconstruida desde un scan real de GearWatch',summary:'Punto de referencia calculado con el estado versionado que existía en este commit. No es un checkpoint 3h capturado en vivo.',checkpoint_label:`BACKFILL · ${sha.slice(0,8)}`,drivers:groups.slice().sort((a,b)=>b.pressure-a.pressure).slice(0,3).map(g=>`${g.label}: ${Math.round(g.pressure)}/100`),contradictions:degraded.slice(0,3).map(x=>`${x.name}: ${x.status}`),watch_next:groups.slice().sort((a,b)=>b.gap-a.gap).slice(0,3).map(g=>`${g.label}: gap ${Math.round(g.gap)}`)}
  };
}

const backfill=selected.map(buildSnapshot).filter(x=>Number.isFinite(Date.parse(x.timestamp)));
const live=(HISTORY.snapshots||[]).filter(x=>x?.provenance?.mode!=='GIT_BACKFILL');
const merged=[...backfill,...live].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
const dedup=[];
for(const s of merged){const t=Date.parse(s.timestamp);const i=dedup.findIndex(x=>Math.abs(Date.parse(x.timestamp)-t)<30*60*1000);if(i>=0){if(s?.provenance?.mode!=='GIT_BACKFILL')dedup[i]=s}else dedup.push(s)}
await fs.mkdir('data/history',{recursive:true});
await fs.writeFile(HISTORY_PATH,JSON.stringify({version:'1.2.0',window_id:WINDOW.id,generated_at:new Date().toISOString(),cadence_hours:3,reference_backfill:{start:new Date(start).toISOString(),end:new Date(end).toISOString(),source:'git-history:data/current.json',points:backfill.length},snapshots:dedup},null,2)+'\n');
console.log(`window backfill: ${backfill.length} historical points + ${live.length} live points = ${dedup.length}`);
