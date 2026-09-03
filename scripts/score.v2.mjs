export const clamp=(n,min=0,max=100)=>Math.max(min,Math.min(max,n));
const phaseBase={LEAD:11,CONFIRM:17,LAG:4};

function ageHours(ts,now=Date.now()){
  const t=Date.parse(ts||'');return Number.isFinite(t)?Math.max(0,(now-t)/36e5):null;
}

export function evidenceStats(evidence=[]){
  const valid=evidence.filter(e=>e?.valid&&!e?.contradiction);
  const contradictions=evidence.filter(e=>e?.valid&&e?.contradiction);
  const domains=new Set(valid.map(e=>e.source_domain).filter(Boolean));
  const signals={LEAD:new Set(),CONFIRM:new Set(),LAG:new Set()};
  for(const e of valid)signals[e.phase]?.add(e.signal||e.query_id||e.claim);
  const counts={LEAD:signals.LEAD.size,CONFIRM:signals.CONFIRM.size,LAG:signals.LAG.size};
  const total=counts.LEAD+counts.CONFIRM+counts.LAG;
  return {valid,contradictions,domains:[...domains],signals,counts,total,lag_share:total?counts.LAG/total:0};
}

export function causalScore(evidence=[],verified=[]){
  const s=evidenceStats(evidence);let score=0;
  const seen=new Set();
  for(const e of s.valid){
    const k=`${e.phase}|${e.signal}`;if(seen.has(k))continue;seen.add(k);
    score+=phaseBase[e.phase]||3;
    const g=Number(e.source_grade||0);if(g>=.9)score+=3;else if(g>=.8)score+=2;else if(g>=.6)score+=1;
    const age=ageHours(e.published_at||e.retrieved_at);if(age!=null&&age<=6)score+=3;else if(age!=null&&age<=24)score+=1;
  }
  if(s.domains.length>=2)score+=7;if(s.domains.length>=3)score+=4;
  if(s.counts.LEAD>=1&&s.counts.CONFIRM>=1)score+=8;
  if(s.counts.LEAD>=2)score+=4;
  score-=Math.min(24,s.contradictions.length*12);
  const verifiedDomains=new Set((verified||[]).filter(x=>x.valid&&!x.contradiction).map(x=>x.source_domain).filter(Boolean));
  score+=Math.min(12,verifiedDomains.size*6);
  if(s.counts.CONFIRM===0)score=Math.min(score,64);
  if(s.counts.LEAD===0&&s.counts.CONFIRM===0&&s.counts.LAG>0)score=Math.min(score,35);
  return {score:Math.round(clamp(score)),...s,verified_domains:[...verifiedDomains]};
}

export function marketConfirmation(metrics=[]){
  const usable=metrics.filter(x=>x&&Number.isFinite(x.ret5));
  if(!usable.length)return {score:0,crowding:0,breadth:0,quality:'NONE',n:0,avg:{r1:0,r5:0,r20:0,volumeZ:0},above20:0,above50:0};
  const avg=k=>usable.reduce((a,x)=>a+(Number.isFinite(x[k])?x[k]:0),0)/usable.length;
  const ratio=fn=>usable.filter(fn).length/usable.length;
  const breadth=ratio(x=>x.ret5>0),above20=ratio(x=>x.above20===true),above50=ratio(x=>x.above50===true);
  const r1=avg('ret1'),r5=avg('ret5'),r20=avg('ret20'),vz=avg('volumeZ');let score=0;
  if(breadth>=.55)score+=16;if(breadth>=.75)score+=8;
  if(r1>=.5)score+=8;if(r1>=1.5)score+=6;
  if(r5>=1.5)score+=14;if(r5>=3)score+=8;
  if(vz>=.8)score+=12;if(vz>=1.5)score+=6;
  if(above20>=.6)score+=10;if(above50>=.6)score+=6;
  const crowding=clamp(Math.max(0,r5)*5+Math.max(0,r20)*2+Math.max(0,vz)*7+(breadth>.85?8:0));
  return {score:Math.round(clamp(score)),crowding:+crowding.toFixed(1),breadth:+breadth.toFixed(3),quality:usable.length>=3?'MEDIUM':'LOW',n:usable.length,above20:+above20.toFixed(3),above50:+above50.toFixed(3),avg:{r1:+r1.toFixed(2),r5:+r5.toFixed(2),r20:+r20.toFixed(2),volumeZ:+vz.toFixed(2)}};
}

export function stateFrom({causal,market,stale=false,invalidated=false,policy}){
  if(stale)return 'STALE';if(invalidated)return 'INVALIDATED';
  const g=policy.state_gates||{};
  if(causal.total===0)return 'UNKNOWN';
  const canActive=causal.counts.CONFIRM>=1&&causal.domains.length>=2&&(causal.counts.LEAD>=1||causal.counts.CONFIRM>=2);
  if(canActive&&causal.score>=(g.active||65)&&(market.crowding>=(g.saturated_crowding||72)||causal.lag_share>.55&&market.score>60))return 'SATURATED';
  if(canActive&&causal.score>=(g.active||65))return 'ACTIVE';
  if(causal.score>=(g.arming||45))return 'ARMING';
  if(causal.score>=(g.watch||25))return 'WATCH';
  return 'DORMANT';
}

export function alphaClick({causal,market,policy,reliability={samples:0,hit_rate:null},invalidated=false}){
  const a=policy.alpha||{};const enoughHistory=(reliability.samples||0)>=(a.reliability_gate_after_samples||5);
  const relOK=!enoughHistory||(reliability.hit_rate??0)>=(a.min_empirical_reliability??.35);
  const eligible=!invalidated&&causal.score>=(a.min_causal||60)&&causal.counts.LEAD>=1&&(!a.require_confirm||causal.counts.CONFIRM>=1)&&causal.domains.length>=(a.min_independent_domains||2)&&causal.lag_share<=(a.max_lag_share||.45)&&market.score>=(a.min_market||20)&&market.score<=(a.max_market||58)&&market.crowding<(a.max_crowding||62)&&relOK;
  const sourceQuality=Math.min(100,causal.domains.length*25+causal.counts.LEAD*10+causal.counts.CONFIRM*15);
  const relScore=enoughHistory?clamp((reliability.hit_rate||0)*100):50;
  const raw=.38*causal.score+.20*market.score+.12*sourceQuality+.10*relScore+.10*Math.min(100,causal.counts.LEAD*30)+.10*Math.min(100,causal.counts.CONFIRM*45)-.22*market.crowding-.12*(causal.lag_share*100);
  const reasons=[];
  if(causal.score<(a.min_causal||60))reasons.push('CAUSAL_TOO_WEAK');
  if(causal.counts.LEAD<1)reasons.push('NO_LEAD');
  if(a.require_confirm&&causal.counts.CONFIRM<1)reasons.push('NO_CONFIRM');
  if(causal.domains.length<(a.min_independent_domains||2))reasons.push('INSUFFICIENT_SOURCES');
  if(market.score<(a.min_market||20))reasons.push('MARKET_NOT_CONFIRMING');
  if(market.score>(a.max_market||58)||market.crowding>=(a.max_crowding||62))reasons.push('TOO_CROWDED');
  if(causal.lag_share>(a.max_lag_share||.45))reasons.push('LAG_DOMINATES');
  if(!relOK)reasons.push('POOR_HISTORY');
  return {eligible,score:+clamp(raw).toFixed(1),reasons:eligible?['CAUSAL_PLUS_EARLY_MARKET_CONFIRMATION']:reasons,empirical:reliability};
}
