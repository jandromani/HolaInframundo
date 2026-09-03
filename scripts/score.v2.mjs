export const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,n));
const phaseBase={LEAD:11,CONFIRM:17,LAG:4};
const STOP=new Set(['with','from','that','this','into','after','before','over','under','their','about','have','will','would','could','should','market','company','reports','report']);

function ageHours(ts,now=Date.now()){
  const t=Date.parse(ts||'');return Number.isFinite(t)?Math.max(0,(now-t)/36e5):null;
}
function tokens(s,min=4){return new Set(String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>=min&&!STOP.has(x)))}
function jaccard(a,b){if(!a.size||!b.size)return 0;let n=0;for(const x of a)if(b.has(x))n++;return n/(a.size+b.size-n)}
function canonicalUrl(u){try{const x=new URL(u);return `${x.hostname.replace(/^www\./,'')}${x.pathname}`.replace(/\/$/,'').toLowerCase()}catch{return String(u||'').split(/[?#]/)[0].toLowerCase()}}

export function clusterEvidence(evidence=[],opts={}){
  const threshold=opts.claim_jaccard_threshold??.58,maxGap=opts.max_time_gap_hours??72,minToken=opts.min_token_length??4;
  const rows=evidence.filter(e=>e?.valid&&!e?.contradiction).slice().sort((a,b)=>(Number(b.source_grade||0)-Number(a.source_grade||0))||String(b.published_at||'').localeCompare(String(a.published_at||'')));
  const clusters=[];
  for(const e of rows){
    const et=tokens(e.claim,minToken),eu=canonicalUrl(e.source_url),ets=Date.parse(e.published_at||e.retrieved_at||'');let hit=null;
    for(const c of clusters){
      if(c.phase!==e.phase||c.signal!==e.signal)continue;
      const gap=Number.isFinite(ets)&&Number.isFinite(c.ts)?Math.abs(ets-c.ts)/36e5:0;
      if(gap>maxGap)continue;
      if((eu&&c.urls.has(eu))||jaccard(et,c.tokens)>=threshold){hit=c;break}
    }
    if(!hit){clusters.push({id:`evt_${clusters.length+1}`,phase:e.phase,signal:e.signal,claim:e.claim,rep:e,tokens:et,urls:new Set(eu?[eu]:[]),domains:new Set(e.source_domain?[e.source_domain]:[]),members:[e],ts:Number.isFinite(ets)?ets:Date.now()});continue}
    hit.members.push(e);if(eu)hit.urls.add(eu);if(e.source_domain)hit.domains.add(e.source_domain);
    if(Number(e.source_grade||0)>Number(hit.rep.source_grade||0)){hit.rep=e;hit.claim=e.claim;hit.tokens=et}
  }
  return clusters.map(c=>({id:c.id,phase:c.phase,signal:c.signal,claim:c.claim,rep:c.rep,member_count:c.members.length,domains:[...c.domains],source_urls:c.members.map(x=>x.source_url).filter(Boolean),members:c.members}));
}

export function evidenceStats(evidence=[],eventPolicy={}){
  const rawValid=evidence.filter(e=>e?.valid&&!e?.contradiction),contradictions=evidence.filter(e=>e?.valid&&e?.contradiction),clusters=clusterEvidence(rawValid,eventPolicy),valid=clusters.map(c=>c.rep);
  const domains=new Set(valid.map(e=>e.source_domain).filter(Boolean)),signals={LEAD:new Set(),CONFIRM:new Set(),LAG:new Set()};
  for(const c of clusters)signals[c.phase]?.add(c.signal||c.rep?.query_id||c.claim);
  const counts={LEAD:signals.LEAD.size,CONFIRM:signals.CONFIRM.size,LAG:signals.LAG.size},total=counts.LEAD+counts.CONFIRM+counts.LAG;
  return {valid,raw_valid:rawValid,contradictions,domains:[...domains],signals,counts,total,lag_share:total?counts.LAG/total:0,event_clusters:clusters,event_count:clusters.length,duplicate_count:Math.max(0,rawValid.length-clusters.length)};
}

export function causalScore(evidence=[],verified=[],eventPolicy={}){
  const s=evidenceStats(evidence,eventPolicy);let score=0;const seen=new Set();
  for(const e of s.valid){
    const k=`${e.phase}|${e.signal}`;if(seen.has(k))continue;seen.add(k);score+=phaseBase[e.phase]||3;
    const g=Number(e.source_grade||0);if(g>=.9)score+=3;else if(g>=.8)score+=2;else if(g>=.6)score+=1;
    const age=ageHours(e.published_at||e.retrieved_at);if(age!=null&&age<=6)score+=3;else if(age!=null&&age<=24)score+=1;
  }
  if(s.event_count>=2)score+=4;if(s.event_count>=4)score+=3;
  if(s.domains.length>=2)score+=7;if(s.domains.length>=3)score+=4;
  if(s.counts.LEAD>=1&&s.counts.CONFIRM>=1)score+=8;if(s.counts.LEAD>=2)score+=4;
  score-=Math.min(24,s.contradictions.length*12);
  const verifiedDomains=new Set((verified||[]).filter(x=>x.valid&&!x.contradiction).map(x=>x.source_domain).filter(Boolean));score+=Math.min(12,verifiedDomains.size*6);
  if(s.counts.CONFIRM===0)score=Math.min(score,64);if(s.counts.LEAD===0&&s.counts.CONFIRM===0&&s.counts.LAG>0)score=Math.min(score,35);
  return {score:Math.round(clamp(score)),...s,verified_domains:[...verifiedDomains]};
}

const get=(x,k)=>k.startsWith('i.')?x?.intraday?.[k.slice(2)]:x?.[k];
export function marketConfirmation(input=[]){
  const positive=Array.isArray(input)?input:(input.positive||[]),negative=Array.isArray(input)?[]:(input.negative||[]),benchmark=Array.isArray(input)?null:input.benchmark;
  const signed=[...positive.map(x=>({x,sign:1})),...negative.map(x=>({x,sign:-1}))].filter(o=>o.x&&Number.isFinite(o.x.ret5));
  if(!signed.length)return {score:0,crowding:0,breadth:0,relative_breadth:0,intraday_breadth:0,quality:'NONE',n:0,intraday_n:0,avg:{r1:0,r5:0,r20:0,rel5:0,rel20:0,r30m:0,r2h:0,rel30m:0,rel2h:0,volumeZ:0},above20:0,above50:0};
  const sig=(o,k)=>{const v=get(o.x,k);return Number.isFinite(v)?o.sign*v:null},bench=k=>{const v=get(benchmark,k);return Number.isFinite(v)?v:0},rel=(o,k)=>{const v=get(o.x,k);return Number.isFinite(v)?o.sign*(v-bench(k)):null};
  const avgFn=fn=>{const a=signed.map(fn).filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:0},ratio=fn=>signed.filter(fn).length/signed.length;
  const r1=avgFn(o=>sig(o,'ret1')),r5=avgFn(o=>sig(o,'ret5')),r20=avgFn(o=>sig(o,'ret20')),rel5=avgFn(o=>rel(o,'ret5')),rel20=avgFn(o=>rel(o,'ret20')),vz=avgFn(o=>Number(o.x.volumeZ||0));
  const intra=signed.filter(o=>Number.isFinite(get(o.x,'i.ret2h'))),intradayN=intra.length,avgI=fn=>{const a=intra.map(fn).filter(Number.isFinite);return a.length?a.reduce((x,y)=>x+y,0)/a.length:0};
  const r30m=avgI(o=>sig(o,'i.ret30m')),r2h=avgI(o=>sig(o,'i.ret2h')),rel30m=avgI(o=>rel(o,'i.ret30m')),rel2h=avgI(o=>rel(o,'i.ret2h'));
  const breadth=ratio(o=>(sig(o,'ret5')??-999)>0),relativeBreadth=ratio(o=>(rel(o,'ret5')??-999)>0),intradayBreadth=intradayN?intra.filter(o=>(rel(o,'i.ret2h')??-999)>0).length/intradayN:0;
  const above20=ratio(o=>o.sign===1?o.x.above20===true:o.x.above20===false),above50=ratio(o=>o.sign===1?o.x.above50===true:o.x.above50===false);let score=0;
  if(relativeBreadth>=.55)score+=14;if(relativeBreadth>=.75)score+=8;if(rel5>=.75)score+=12;if(rel5>=2)score+=7;
  if(intradayN){if(intradayBreadth>=.55)score+=10;if(intradayBreadth>=.75)score+=5;if(rel2h>=.25)score+=8;if(rel2h>=.75)score+=5}
  if(vz>=.8)score+=8;if(vz>=1.5)score+=4;if(above20>=.6)score+=7;if(above50>=.6)score+=4;if(breadth>=.6)score+=4;
  const crowding=clamp(Math.max(0,rel5)*6+Math.max(0,rel20)*2.2+Math.max(0,rel2h)*8+Math.max(0,vz)*6+(relativeBreadth>.85?8:0));
  const quality=signed.length>=3&&intradayN>=2?'HIGH':signed.length>=2?'MEDIUM':'LOW';
  return {score:Math.round(clamp(score)),crowding:+crowding.toFixed(1),breadth:+breadth.toFixed(3),relative_breadth:+relativeBreadth.toFixed(3),intraday_breadth:+intradayBreadth.toFixed(3),quality,n:signed.length,intraday_n:intradayN,above20:+above20.toFixed(3),above50:+above50.toFixed(3),benchmark:benchmark?.ticker||null,avg:{r1:+r1.toFixed(2),r5:+r5.toFixed(2),r20:+r20.toFixed(2),rel5:+rel5.toFixed(2),rel20:+rel20.toFixed(2),r30m:+r30m.toFixed(2),r2h:+r2h.toFixed(2),rel30m:+rel30m.toFixed(2),rel2h:+rel2h.toFixed(2),volumeZ:+vz.toFixed(2)}};
}

export function stateFrom({causal,market,stale=false,invalidated=false,policy}){
  if(stale)return 'STALE';if(invalidated)return 'INVALIDATED';const g=policy.state_gates||{};if(causal.total===0)return 'UNKNOWN';
  const canActive=causal.counts.CONFIRM>=1&&causal.domains.length>=2&&(causal.counts.LEAD>=1||causal.counts.CONFIRM>=2);
  if(canActive&&causal.score>=(g.active||65)&&(market.crowding>=(g.saturated_crowding||72)||causal.lag_share>.55&&market.score>60))return 'SATURATED';
  if(canActive&&causal.score>=(g.active||65))return 'ACTIVE';if(causal.score>=(g.arming||45))return 'ARMING';if(causal.score>=(g.watch||25))return 'WATCH';return 'DORMANT';
}

export function hysteresisState({raw,previous=null,pending=null,causal,invalidated=false,policy}){
  if(invalidated||raw==='INVALIDATED')return {state:'INVALIDATED',raw_state:raw,pending:null,applied:true,reason:'INVALIDATION_IMMEDIATE'};
  if(!previous||previous==='UNKNOWN'||previous==='STALE'){
    if(['ACTIVE','SATURATED'].includes(raw)&&causal.score<(policy.state_gates?.fast_path_causal||86))return {state:'ARMING',raw_state:raw,pending:{candidate:'ACTIVE',streak:1,required:policy.state_gates?.active_confirmation_runs||2},applied:true,reason:'FIRST_ACTIVE_OBSERVATION'};
    return {state:raw,raw_state:raw,pending:null,applied:false,reason:'INITIAL'};
  }
  if(raw===previous)return {state:previous,raw_state:raw,pending:null,applied:false,reason:'STABLE'};
  if(previous==='ACTIVE'&&raw==='SATURATED')return {state:'SATURATED',raw_state:raw,pending:null,applied:true,reason:'SATURATION_IMMEDIATE'};
  const rank={UNKNOWN:0,DORMANT:1,WATCH:2,ARMING:3,ACTIVE:4,SATURATED:5,STALE:0,INVALIDATED:-1},promotion=(rank[raw]??0)>(rank[previous]??0),needsActive=promotion&&['ACTIVE','SATURATED'].includes(raw)&&!['ACTIVE','SATURATED'].includes(previous),needsDemotion=!promotion&&['ACTIVE','SATURATED'].includes(previous)&&!['ACTIVE','SATURATED'].includes(raw);
  if(!needsActive&&!needsDemotion)return {state:raw,raw_state:raw,pending:null,applied:false,reason:'DIRECT_NONCRITICAL_TRANSITION'};
  if(needsActive&&causal.score>=(policy.state_gates?.fast_path_causal||86))return {state:raw,raw_state:raw,pending:null,applied:true,reason:'FAST_PATH_CAUSAL'};
  const candidate=needsActive?'ACTIVE':raw,required=needsActive?(policy.state_gates?.active_confirmation_runs||2):(policy.state_gates?.deactivate_confirmation_runs||2),streak=pending?.candidate===candidate?(pending.streak||0)+1:1;
  if(streak>=required)return {state:raw,raw_state:raw,pending:null,applied:true,reason:needsActive?'ACTIVE_CONFIRMED':'DEACTIVATION_CONFIRMED'};
  return {state:previous,raw_state:raw,pending:{candidate,streak,required},applied:true,reason:needsActive?'AWAITING_ACTIVE_CONFIRMATION':'AWAITING_DEACTIVATION_CONFIRMATION'};
}

export function alphaClick({causal,market,policy,reliability={samples:0,hit_rate:null},invalidated=false,state=null}){
  const a=policy.alpha||{},enoughHistory=(reliability.samples||0)>=(a.reliability_gate_after_samples||5),relOK=!enoughHistory||(reliability.hit_rate??0)>=(a.min_empirical_reliability??.35),stableOK=!a.require_stable_active||state==='ACTIVE';
  const eligible=!invalidated&&stableOK&&causal.score>=(a.min_causal||60)&&causal.counts.LEAD>=1&&(!a.require_confirm||causal.counts.CONFIRM>=1)&&causal.domains.length>=(a.min_independent_domains||2)&&causal.lag_share<=(a.max_lag_share||.45)&&market.score>=(a.min_market||20)&&market.score<=(a.max_market||64)&&market.crowding<(a.max_crowding||66)&&relOK;
  const sourceQuality=Math.min(100,causal.domains.length*25+causal.counts.LEAD*10+causal.counts.CONFIRM*15),relScore=enoughHistory?clamp((reliability.hit_rate||0)*100):50,raw=.36*causal.score+.22*market.score+.12*sourceQuality+.10*relScore+.10*Math.min(100,causal.counts.LEAD*30)+.10*Math.min(100,causal.counts.CONFIRM*45)-.22*market.crowding-.12*(causal.lag_share*100),reasons=[];
  if(!stableOK)reasons.push('STATE_NOT_STABLY_ACTIVE');if(causal.score<(a.min_causal||60))reasons.push('CAUSAL_TOO_WEAK');if(causal.counts.LEAD<1)reasons.push('NO_LEAD');if(a.require_confirm&&causal.counts.CONFIRM<1)reasons.push('NO_CONFIRM');if(causal.domains.length<(a.min_independent_domains||2))reasons.push('INSUFFICIENT_SOURCES');if(market.score<(a.min_market||20))reasons.push('MARKET_NOT_CONFIRMING');if(market.score>(a.max_market||64)||market.crowding>=(a.max_crowding||66))reasons.push('TOO_CROWDED');if(causal.lag_share>(a.max_lag_share||.45))reasons.push('LAG_DOMINATES');if(!relOK)reasons.push('POOR_HISTORY');
  return {eligible,score:+clamp(raw).toFixed(1),reasons:eligible?['STABLE_CAUSAL_PLUS_EARLY_RELATIVE_MARKET_CONFIRMATION']:reasons,empirical:reliability};
}
