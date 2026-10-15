// Publish a coherent, read-only V6 snapshot from the existing V5 outputs.
// The output is explicitly a projection, never a replacement for original source data.
import fs from 'node:fs/promises';
import {projectV6} from '../lib/v6-core.mjs';

const read=async(path,fallback)=>{try{return JSON.parse(await fs.readFile(path,'utf8'))}catch(e){
 if(e?.code==='ENOENT')return fallback;
 throw new Error('Invalid required V6 input '+path+': '+e.message);
}};
const current=await read('data/current.json',{mechanisms:{}});
const investment=await read('data/investment-layer.json',{strategies:{}});
const pricing=await read('data/pricing-sensors.json',{observations:{},coverage:{}});
const market=await read('data/market.json',{});
const conf=await read('config/shock-groups.v6.json',{groups:[]});
const graph=await read('config/edges.v2.json',{edges:[]});
const previous=await read('data/v6/world-current.json',{});
if(!current.run_id)throw new Error('Cannot publish V6 without a real V5 run_id');
if(investment.run_id && investment.run_id!==current.run_id)throw new Error('V6 source run mismatch: investment');
if(market.run_id && market.run_id!==current.run_id)throw new Error('V6 source run mismatch: market');
const enabled=new Set(Object.keys(current.mechanisms||{}));
for(const group of conf.groups||[])for(const id of group.mechanism_ids||[]){
 if(!enabled.has(id))throw new Error('Unknown V6 mechanism '+id+' in group '+group.id);
}
for(const e of graph.edges||[])if(!enabled.has(e.from)||!enabled.has(e.to)){
 throw new Error('Unknown causal edge: '+e.from+' -> '+e.to);
}
const out=projectV6({current,investment,pricing,previous,groups:conf.groups,edges:graph.edges});
out.health.market_snapshot_asof=market.generated_at||null;
out.health.company_source_asof=investment.generated_at||null;
out.health.source_integrity=(!investment.run_id||market.run_id===current.run_id) && Object.keys(investment.strategies||{}).length===26?'COMPLETE':'PARTIAL';
const now=new Date().toISOString();
out.generated_at=now;
await fs.mkdir('data/v6/history',{recursive:true});
await fs.writeFile('data/v6/world-current.json',JSON.stringify(out,null,2)+'\n');
const publicSummary={
 schema_version:'6.0.0',run_id:out.run_id,as_of:out.as_of,generated_at:now,
 homepage:out.homepage,shocks:out.shocks,
 health:{pipeline:out.health.pipeline,source_integrity:out.health.source_integrity,
  pricing_coverage:out.health.pricing_coverage,stale_or_unavailable_sources:out.health.stale_or_unavailable_sources}
};
await fs.writeFile('data/v6/homepage.json',JSON.stringify(publicSummary,null,2)+'\n');
const companySummary={
 schema_version:'6.0.0',run_id:out.run_id,as_of:out.as_of,
 company_count:out.companies.company_count,by_ticker:out.companies.by_ticker,
 notice:out.companies.notice
};
await fs.writeFile('data/v6/companies.json',JSON.stringify(companySummary,null,2)+'\n');
await fs.writeFile('data/v6/alerts.json',JSON.stringify({version:'6.0.0',run_id:out.run_id,generated_at:now,alerts:out.alerts},null,2)+'\n');
// Immutable roll-forward index: hashes and timestamps, not a rewrite of history.
const histPath='data/v6/history/checkpoints.json';
const history=await read(histPath,{version:'6.0.0',runs:[]});
const checkpoint={run_id:out.run_id,as_of:out.as_of,generated_at:now,shocks:out.shocks.map(s=>({
 id:s.id,priority_score:s.priority_score,causal_max:s.causal_max,
 evidence_quality:s.evidence_quality,market_phase:s.market_phase
}))};
history.runs=(history.runs||[]).filter(r=>r.run_id!==out.run_id);
history.runs.push(checkpoint);
history.runs=history.runs.sort((a,b)=>a.as_of.localeCompare(b.as_of)).slice(-800);
await fs.writeFile(histPath,JSON.stringify(history,null,2)+'\n');
// Historical case study: point-in-time engine telemetry and ex-post price closes are separate.
// A later market price must never be represented as information known at the earlier run.
const series=await read('data/series.json',{points:[]});
const caseMechanisms=['CRUDE_TANKER_DISLOCATION','ATLANTIC_BARREL_PREMIUM','LNG_REROUTING','DIESEL_REFINING_CRISIS','PRODUCT_TANKER_TONMILES'];
const daily=new Map();
for(const point of series.points||[]){
 const ts=point.ts||point.timestamp;
 if(!ts || ts<'2026-10-02T00:00:00' || ts>'2026-10-15T23:59:59')continue;
 const day=ts.slice(0,10),prev=daily.get(day);
 if(prev && prev.timestamp>=ts)continue;
 daily.set(day,{date:day,timestamp:ts,run_id:point.run_id,
  mechanisms:Object.fromEntries(caseMechanisms.map(id=>{const m=point.mechanisms?.[id];
    return [id,m?{score:m.score,state:m.state,market_score:m.market_score,
      priced_in_proxy:m.priced_in,wave_phase:m.wave_phase}:null]}))
 });
}
const closingPrices={};
for(const ticker of ['GTE','PSHG']){
 const bars=market.metrics?.[ticker]?.daily_bars||[];
 closingPrices[ticker]=bars.filter(p=>(p.t||'')>='2026-10-02' && (p.t||'')<='2026-10-15T23:59:59')
  .map(p=>({date:String(p.t).slice(0,10),close:p.close}))
  .filter(p=>Number.isFinite(p.close));
}
const hormuzCase={
 schema_version:'6.0.0',case_id:'HORMUZ_OCT_2026',
 series_provenance:'CONTEMPORANEOUS_ENGINE_SNAPSHOTS',
 prices_provenance:'EX_POST_HISTORICAL_MARKET_BARS',
 no_lookahead:true,
 generated_at:now,
 warning:'Historical market prices were retrieved later, cannot be treated as live signals on the corresponding date. Engine score snapshots are not proof that specific physical events were verified.',
 checkpoints:[...daily.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)),
 ex_post_closes:closingPrices
};
await fs.writeFile('data/v6/history/hormuz-case.json',JSON.stringify(hormuzCase,null,2)+'\n');

console.log('GearWatch V6 published: '+out.run_id+', shocks '+out.shocks.length+
 ', companies '+out.companies.company_count+', alerts '+out.alerts.length+
 ', integrity '+out.health.source_integrity);
