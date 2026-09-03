import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {causalScore,marketConfirmation,stateFrom,alphaClick} from './score.v2.mjs';

const mechCfg=JSON.parse(await fs.readFile('config/mechanisms.json','utf8'));
const policy=JSON.parse(await fs.readFile('config/policy.v2.json','utf8'));
const extraction=JSON.parse(await fs.readFile('data/extraction/latest.json','utf8').catch(()=>'{"mechanisms":{},"errors":[]}'));
const verification=JSON.parse(await fs.readFile('data/verification/latest.json','utf8').catch(()=>'{"mechanisms":{},"errors":[]}'));
const market=JSON.parse(await fs.readFile('data/market.json','utf8').catch(()=>'{"metrics":{},"context":{},"errors":[]}'));
const previous=JSON.parse(await fs.readFile('data/current.json','utf8').catch(()=>'{"mechanisms":{}}'));
const correlations=JSON.parse(await fs.readFile('data/correlation-memory.json','utf8').catch(()=>'{"mechanisms":{},"edges":[]}'));
const series=JSON.parse(await fs.readFile('data/series.json','utf8').catch(()=>'{"points":[]}'));
const ledger=JSON.parse(await fs.readFile('data/alpha-clicks.json','utf8').catch(()=>'{"signals":[]}'));
const now=new Date();const runId=extraction.run_id||market.run_id||`run_${now.toISOString().replace(/[:.]/g,'-')}`;
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,22);
const tierStale={A:10,B:20,C:32};

function reliability(id){
  const x=correlations.mechanisms?.[id]||{};return {samples:x.alpha_5d?.samples||0,hit_rate:x.alpha_5d?.hit_rate??null,avg_return:x.alpha_5d?.avg_return??null,lead_to_confirm:x.lead_to_confirm?.rate??null};
}
function invalidateFrom(v){return v?.verdict==='CONTRADICTED'&&(v.verified||[]).some(x=>x.contradiction)}
function adjustedCausal(evidence,verified,verdict){
  const c=causalScore(evidence,verified);if(verdict==='CONTRADICTED')c.score=Math.max(0,c.score-22);else if(verdict==='MIXED')c.score=Math.max(0,c.score-8);return c;
}
function eventize(m,e){return {id:hash(`${m.id}|${e.claim}|${e.source_url}`),mechanism_id:m.id,run_id:runId,observed_at:e.published_at||e.retrieved_at,ingested_at:now.toISOString(),...e}}
function basketPrices(tickers){const x={};for(const t of tickers||[]){const p=market.metrics?.[t]?.price;if(Number.isFinite(p))x[t]=p}return x}
function avgReturn(entries,current){const vals=[];for(const [t,p0] of Object.entries(entries||{})){const p1=current?.[t]?.price;if(Number.isFinite(p0)&&Number.isFinite(p1)&&p0!==0)vals.push((p1/p0-1)*100)}return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null}

const mechanisms={};const transitions=[];
for(const m of mechCfg.mechanisms){
  const x=extraction.mechanisms?.[m.id],v=verification.mechanisms?.[m.id],prev=previous.mechanisms?.[m.id];
  if(!x){
    if(prev){
      const age=(Date.now()-Date.parse(prev.last_run||previous.updated_at||0))/36e5;const stale=age>(tierStale[m.tier]||24);const mkt=marketConfirmation((m.positive||[]).map(t=>market.metrics?.[t]).filter(Boolean));
      mechanisms[m.id]={...prev,market:mkt,state:stale?'STALE':prev.state,stale,updated_market_at:market.generated_at||null};
    }
    continue;
  }
  const evidence=x.evidence||[],verified=v?.verified||[];const causal=adjustedCausal(evidence,verified,v?.verdict);const mkt=marketConfirmation((m.positive||[]).map(t=>market.metrics?.[t]).filter(Boolean));const invalidated=invalidateFrom(v);const state=stateFrom({causal,market:mkt,invalidated,policy});const rel=reliability(m.id);const alpha=alphaClick({causal,market:mkt,policy,reliability:rel,invalidated});
  const events=evidence.map(e=>eventize(m,e));
  const obj={id:m.id,label:m.label,tier:m.tier,state,score:causal.score,previous_state:prev?.state||null,score_delta:causal.score-(prev?.score||0),summary:x.summary,material_change:Math.abs(causal.score-(prev?.score||0))>=8||state!==prev?.state,evidence,verified,verifier:{verdict:v?.verdict||'NOT_RUN',summary:v?.summary||'',next_check:v?.next_check||''},events,expected_next:x.expected_next||[],invalidation:x.invalidation||[],market:mkt,alpha,reliability:rel,sensors:{lead:causal.counts.LEAD,confirm:causal.counts.CONFIRM,lag:causal.counts.LAG,lag_share:+causal.lag_share.toFixed(3),domains:causal.domains},positive:m.positive||[],negative:m.negative||[],last_run:now.toISOString(),model:x.model,usage:x.usage||null,candidate_count:x.candidate_count||0,query_trace:(x.query_trace||[]).map(q=>({query_id:q.query_id,phase:q.phase,signal:q.signal,q:q.q,engines:q.engines}))};
  mechanisms[m.id]=obj;if(!prev||prev.state!==state||Math.abs(obj.score_delta)>=10)transitions.push({mechanism_id:m.id,from:prev?.state||null,to:state,score:obj.score,delta:obj.score_delta,at:now.toISOString()});
}

const prevAlpha=previous.mechanisms||{};
for(const m of mechCfg.mechanisms){
  const cur=mechanisms[m.id];if(!cur)continue;
  const was=prevAlpha[m.id]?.alpha?.eligible===true;
  if(cur.alpha?.eligible&&!was){
    const entry=basketPrices(cur.positive);const bench=market.context?.['^GSPC']?.price;
    if(Object.keys(entry).length)ledger.signals.push({id:`alpha_${hash(`${m.id}|${now.toISOString()}`)}`,mechanism_id:m.id,label:m.label,created_at:now.toISOString(),run_id:runId,alpha_score:cur.alpha.score,causal_score:cur.score,market_score:cur.market.score,crowding:cur.market.crowding,state:cur.state,tickers:cur.positive,entry_prices:entry,benchmark_entry:Number.isFinite(bench)?bench:null,horizons:{d1:null,d5:null,d20:null},status:'OPEN'});
  }
}

for(const s of ledger.signals){
  const ageDays=(Date.now()-Date.parse(s.created_at))/864e5;
  const mechanism=mechanisms[s.mechanism_id];
  for(const [key,days] of [['d1',1],['d5',5],['d20',20]]){
    if(s.horizons?.[key]||ageDays<days)continue;
    const r=avgReturn(s.entry_prices,market.metrics);const b0=s.benchmark_entry,b1=market.context?.['^GSPC']?.price;const br=Number.isFinite(b0)&&Number.isFinite(b1)&&b0?((b1/b0)-1)*100:null;
    if(r!=null)s.horizons[key]={resolved_at:now.toISOString(),basket_return:+r.toFixed(2),benchmark_return:br==null?null:+br.toFixed(2),relative_return:br==null?null:+(r-br).toFixed(2),hit:r>0,relative_hit:br==null?null:r>br};
  }
  if(mechanism?.state==='SATURATED')s.status='SATURATED';else if(mechanism?.state==='INVALIDATED')s.status='INVALIDATED';else if(s.horizons?.d20)s.status='RESOLVED';
}

series.points.push({run_id:runId,ts:now.toISOString(),mechanisms:Object.fromEntries(Object.entries(mechanisms).map(([id,x])=>[id,{score:x.score,state:x.state,market_score:x.market?.score||0,crowding:x.market?.crowding||0,lead:x.sensors?.lead||0,confirm:x.sensors?.confirm||0,lag:x.sensors?.lag||0,alpha:x.alpha?.eligible||false}]))});
if(series.points.length>1600)series.points=series.points.slice(-1600);
const current={version:'2.0.0',updated_at:now.toISOString(),run_id:runId,health:{retrieval_errors:(JSON.parse(await fs.readFile('data/retrieval/latest.json','utf8').catch(()=>'{"errors":[]}')).errors||[]).length,extraction_errors:(extraction.errors||[]).length,verification_errors:(verification.errors||[]).length,market_errors:(market.errors||[]).length,mechanisms:Object.keys(mechanisms).length},transitions,mechanisms};
const run={run_id:runId,updated_at:now.toISOString(),transitions,mechanisms:Object.values(mechanisms).filter(x=>x.last_run===current.updated_at||x.material_change),health:current.health};
await fs.mkdir('data/history-v2',{recursive:true});await fs.writeFile('data/current.json',JSON.stringify(current,null,2)+'\n');await fs.writeFile('data/series.json',JSON.stringify(series,null,2)+'\n');await fs.writeFile('data/alpha-clicks.json',JSON.stringify(ledger,null,2)+'\n');await fs.writeFile(`data/history-v2/${runId}.json`,JSON.stringify(run,null,2)+'\n');
console.log(`assemble ${runId}: ${Object.keys(mechanisms).length} mechanisms, ${transitions.length} transitions, ${ledger.signals.length} alpha signals total`);
