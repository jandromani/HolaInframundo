// GearWatch V6 — deterministic, source-aware projection layer.
// The source of truth remains the V5 pipeline; this module creates a read-only V6 projection.
// No AI model can manufacture an observation or an investable recommendation.
import crypto from 'node:crypto';

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const iso=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?new Date(t).toISOString():null};
const ageHours=(v,now)=>{const t=Date.parse(v||'');return Number.isFinite(t)?Math.max(0,(Date.parse(now)-t)/3600000):null};
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,18);
const validSource=e=>/^https?:\/\/[^ ]+/i.test(String(e?.source_url||e?.url||''));
const domain=e=>{try{return new URL(e.source_url||e.url).hostname.replace(/^www\./,'')}catch{return null}};
const uniq=a=>[...new Set(a.filter(Boolean))];
const finite=n=>Number.isFinite(Number(n))?Number(n):null;
const safeArray=x=>Array.isArray(x)?x:[];

export function collectEvents(mechanism,now){
 const observed=safeArray(mechanism?.observed_evidence).length?
  mechanism.observed_evidence:
  safeArray(mechanism?.evidence).filter(e=>!e.carried && e.valid!==false && (e.source_url||e.url));
 const events=[];
 for(const e of observed){
  if(!validSource(e))continue;
  const published_at=iso(e.published_at);
  const effective_at=iso(e.effective_at||e.event_at);
  const retrieved_at=iso(e.retrieved_at);
  const claim=String(e.claim||e.title||'').trim();
  if(!claim)continue;
  const source_url=e.source_url||e.url;
  const id=hash(source_url+'|'+claim.toLowerCase().replace(/\s+/g,' '));
  events.push({id,claim:claim.slice(0,750),source_url,domain:domain(e),
   published_at,effective_at,retrieved_at,
   recorded_at:now,phase:e.phase||e.signal||null,
   event_time_quality:effective_at?'EXPLICIT_EVENT':published_at?'PUBLISHED_ONLY':'UNKNOWN'});
 }
 return [...new Map(events.map(e=>[e.id,e])).values()].slice(0,35);
}

// Physical truth and document freshness are deliberately independent.
// Old evidence stays in the history; lack of new articles never reverses an observed state.
export function mergeWorldState({mechanisms={},previous={},asOf,sourceCoverage={}}){
 const out={};
 for(const [id,m] of Object.entries(mechanisms)){
  const prev=previous[id]||{};
  const fresh=collectEvents(m,asOf);
  const archive=[...fresh,...safeArray(prev.events)].filter(e=>e.id&&e.source_url);
  const events=[...new Map(archive.map(e=>[e.id,e])).values()].slice(0,60);
  const recent=fresh.filter(e=>e.published_at!==null && ageHours(e.published_at,asOf)!==null && ageHours(e.published_at,asOf)<=72);
  const confirmedDomains=uniq(recent.map(e=>e.domain));
  const lastSupported=[...events].map(e=>e.effective_at||e.published_at).filter(Boolean).sort().at(-1)||prev.last_supported_at||null;
  const lastObserved=events.length?events[0].recorded_at||prev.last_observed_at:null;
  const freshHours=ageHours(lastSupported,asOf);
  const physicalEvidenceStatus=confirmedDomains.length>=2?'CORROBORATED_RECENT':
   recent.length?'SINGLE_SOURCE_RECENT':events.length?'HISTORICAL_EVIDENCE':'NO_PRIMARY_EVENT_EVIDENCE';
  const invalidated=m.state==='INVALIDATED' || Boolean(m.invalidated);
  const evidenceLabel=invalidated?'INVALIDATED':physicalEvidenceStatus;
  const observationFreshness=freshHours===null?'UNKNOWN':freshHours<=24?'FRESH':freshHours<=96?'AGING':'STALE';
  out[id]={
   id,label:m.label||id,causal_score:finite(m.score)||0,causal_state:m.state||'UNKNOWN',
   score_delta:finite(m.score_delta)||0,
   physical_evidence_status:evidenceLabel,
   physical_state:invalidated?'INVALIDATED':'NOT_DIRECTLY_MEASURED',
   observation_freshness:observationFreshness,
   source_domains:uniq(events.map(e=>e.domain)),
   last_supported_at:lastSupported,last_observed_at:lastObserved,
   events,quality:{
    independent_recent_domains:confirmedDomains.length,
    recently_published_events:recent.length,
    archived_events:events.length,
    direct_physical_measurement:false,
    coverage:sourceCoverage.status||'PARTIAL',
    warning: 'Causal scores and source articles do not establish a measured physical state.'
   }
  };
 }
 return out;
}

function companyRecord(row,id,inv){
 const t=row?.transmission||{},p=t.passes||{},fin=t.financials||{};
 const evidence=t.path||inv?.transmission_path||{};
 const brokerVerified=row?.broker_verified===true;
 return {
  symbol:row.symbol,mechanism_id:id,exposure:row.exposure||'UNKNOWN',fit:finite(row.fit),
  transmission_score:finite(t.score),risk_adjusted_score:finite(t.risk_adjusted_score),
  rank_score:finite(row.rank_score),market:{
   price:finite(row.market?.price),asof:row.market?.asof||null,
   ret1:finite(row.market?.ret1),ret5:finite(row.market?.ret5),
   ret20:finite(row.market?.ret20),rel5:finite(row.market?.rel5),
   volumeZ:finite(row.market?.volumeZ),quality:row.market?.quality||'UNKNOWN'
  },economics:{
   channel:evidence.earnings_channel||null,
   bridge:safeArray(evidence.bridge),
   diluters:safeArray(evidence.diluters),
   operating_margin:finite(fin.operating_margin),
   fcf_margin:finite(fin.fcf_margin),
   cash_to_debt:finite(fin.cash_to_debt),
   cfo_to_capex:finite(fin.cfo_to_capex),
   market_cap:finite(fin.market_cap)
  },
  data_quality:{
   fundamental:row.fundamental_quality||row.fundamental?.quality||'UNKNOWN',
   coverage:finite(row.fundamental_coverage),
   period_end:row.fundamental?.period_end||null,
   broker_verified:brokerVerified,
   broker_label:brokerVerified?'BROKER_VERIFIED':'UNVERIFIED_CURATED_UNIVERSE'
  },
  capture_status:'EXPOSURE_MODEL_ONLY',
  capture_warning:'Transmission score is structural; incremental spot exposure, hedges and verified earnings sensitivity are not necessarily known.',
  structural_score:finite(p.structural?.score),financial_score:finite(p.financial?.score)
 };
}
export function buildCompanyUniverse(investment){
 const byTicker={},byMechanism={};
 for(const [id,s] of Object.entries(investment?.strategies||{})){
  const rows=safeArray(s.top_candidates).length?s.top_candidates:safeArray(s.top5);
  byMechanism[id]=[];
  for(const row of rows){
   if(!row?.symbol)continue;
   const record=companyRecord(row,id,s);
   byMechanism[id].push(record.symbol);
   (byTicker[record.symbol]??=[]).push(record);
  }
 }
 for(const k of Object.keys(byTicker))byTicker[k].sort((a,b)=>(b.risk_adjusted_score||0)-(a.risk_adjusted_score||0));
 return {by_ticker:byTicker,by_mechanism:byMechanism,company_count:Object.keys(byTicker).length,
  notice:'Company fit is not a prediction of stock return or broker availability.'};
}
export function buildShocks({groups=[],world={},mechanisms={},investment={},edges=[],asOf}){
 const shocks=[];
 for(const g of groups){
  const ids=safeArray(g.mechanism_ids).filter(id=>world[id]);
  const rows=ids.map(id=>world[id]);
  if(!rows.length)continue;
  const causalMax=Math.max(0,...rows.map(r=>r.causal_score));
  const active=rows.filter(r=>r.causal_score>=25);
  const recent=rows.filter(r=>r.physical_evidence_status==='CORROBORATED_RECENT');
  const stale=rows.filter(r=>r.observation_freshness==='STALE'||r.observation_freshness==='UNKNOWN');
  const acceleration=Math.max(0,...rows.map(r=>r.score_delta));
  const priority=clamp(.68*causalMax + Math.min(16,active.length*3) + Math.min(12,acceleration*.4)
     + Math.min(10,recent.length*5) - Math.min(18,stale.length*3));
  const top=rows.slice().sort((a,b)=>b.causal_score-a.causal_score);
  const companies=[];
  for(const r of top){const s=investment?.strategies?.[r.id];for(const c of safeArray(s?.top5).slice(0,4)){if(c?.symbol)companies.push({ticker:c.symbol,mechanism_id:r.id,transmission_score:finite(c.transmission?.score),fit:finite(c.fit)})}}
  const nextEdges=safeArray(edges).filter(e=>ids.includes(e.from) && world[e.to]).map(e=>({
    from:e.from,to:e.to,expected_lag_runs:e.expected_lag_runs||[],
    sign:e.sign,kind:'HYPOTHESIS_NOT_CERTAINTY'
  }));
  shocks.push({
   id:g.id,title:g.title,subtitle:g.subtitle||'',
   group:g.family||'WORLD',priority_score:Math.round(priority),
   observed_mechanisms:active.length,mechanism_ids:ids,
   lead_mechanism:top[0]?.id||null,causal_max:causalMax,
   evidence_quality:recent.length?'RECENT_CORROBORATED_IN_PART':stale.length?'INCOMPLETE_OR_STALE':'EVIDENCE_PENDING',
   evidence_as_of:asOf,
   market_phase:investment?.strategies?.[top[0]?.id]?.wave_phase||null,
   market_priced_in_proxy:finite(investment?.strategies?.[top[0]?.id]?.priced_in),
   drivers:top.slice(0,4).map(r=>({mechanism_id:r.id,score:r.causal_score,state:r.causal_state,
    recent_domains:r.quality.independent_recent_domains,freshness:r.observation_freshness})),
   transmission_hypotheses:nextEdges,
   companies:[...new Map(companies.map(c=>[c.ticker,c])).values()].slice(0,12),
   falsifiers:safeArray(g.falsifiers),next_checks:safeArray(g.next_checks),
   warning:'Priority is an internal research index, not an event probability or expected return.'
  });
 }
 return shocks.sort((a,b)=>b.priority_score-a.priority_score||a.id.localeCompare(b.id));
}
export function makeAlerts(previous=[],shocks=[],world={},asOf){
 const prevById=Object.fromEntries(safeArray(previous).map(s=>[s.id,s]));
 const alerts=[];
 for(const s of shocks){
  const p=prevById[s.id],delta=p?s.priority_score-p.priority_score:null;
  const gainedEvidence=s.drivers.some(d=>world[d.mechanism_id]?.physical_evidence_status==='CORROBORATED_RECENT');
  if(delta!==null && delta>=12 && gainedEvidence){
   alerts.push({id:hash(s.id+'|ESCALATION|'+asOf.slice(0,13)),type:'ESCALATION',shock_id:s.id,
    observed_at:asOf,title:s.title+' — causal pressure accelerated',
    delta,delivery_status:'LOCAL_ONLY',verified:false,detail:'Verify underlying events before any external notification.'});
  }
  if(s.drivers.some(d=>d.score>=45 && d.freshness==='UNKNOWN')){
   alerts.push({id:hash(s.id+'|SENSOR_BLIND|'+asOf.slice(0,10)),type:'SENSOR_BLIND',shock_id:s.id,
    observed_at:asOf,title:s.title+' — missing physical measurement',
    delivery_status:'LOCAL_ONLY',verified:false,detail:'No current direct measurement; do not infer normalization.'});
  }
 }
 return alerts.slice(0,12);
}
export function projectV6({current,investment={},pricing={},previous={},groups=[],edges=[]}){
 const asOf=iso(current?.updated_at)||new Date().toISOString();
 const sourceCoverage=pricing.coverage||{};
 const world=mergeWorldState({mechanisms:current?.mechanisms||{},previous:previous?.world_variables||{},asOf,
  sourceCoverage:{status:sourceCoverage.scored_sources>=5?'BROAD':'PARTIAL'}});
 const companies=buildCompanyUniverse(investment);
 const shocks=buildShocks({groups,world,mechanisms:current?.mechanisms,investment,edges,asOf});
 const alerts=makeAlerts(previous?.shocks||[],shocks,world,asOf);
 const staleSources=Object.entries(pricing?.observations||{}).filter(([,v])=>v.status!=='OK').map(([source,v])=>({source,status:v.status||'UNKNOWN',error:v.error||null}));
 return {
  schema_version:'6.0.0',run_id:current?.run_id||null,as_of:asOf,
  world_variables:world,shocks,companies,alerts,
  homepage:{primary:shocks[0]?.id||null,secondary:shocks.slice(1,3).map(s=>s.id)},
  health:{pipeline:current?.health||{},pricing_coverage:sourceCoverage,
   stale_or_unavailable_sources:staleSources,market_snapshot_asof:null,
   warning:'No push notification or actual user brokerage trades are performed.'}
 };
}
