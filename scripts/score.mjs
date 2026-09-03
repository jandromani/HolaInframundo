export function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,n));}

export function evidenceScore(evidence=[]){
  let score=0;
  const families=new Set();
  const sources=new Set();
  for(const e of evidence){
    if(!e || e.valid===false) continue;
    families.add(e.family);
    if(e.source_url) sources.add(e.source_url);
    const q=Number(e.quality||0);
    if(e.family==='PHYSICAL') score += q>=0.8 ? 20 : 10;
    else if(e.family==='PRICE') score += q>=0.8 ? 15 : 8;
    else if(e.family==='CORPORATE') score += q>=0.8 ? 15 : 8;
    else if(e.family==='POLICY') score += q>=0.8 ? 10 : 5;
    if(e.fresh_hours!=null && e.fresh_hours<=24) score+=5;
    if(e.contradiction) score-=20;
  }
  if(families.size>=2) score+=5;
  if(sources.size>=2) score+=5;
  if(sources.size<=1 && evidence.length) score-=15;
  return clamp(score);
}

export function stateFromScore(score,{unknown=false,invalidated=false,crowding=0}={}){
  if(unknown) return 'UNKNOWN';
  if(invalidated) return 'INVALIDATED';
  if(score>=70 && crowding>=75) return 'SATURATED';
  if(score>=70) return 'ACTIVE';
  if(score>=45) return 'ARMING';
  if(score>=25) return 'WATCH';
  return 'DORMANT';
}

export function marketConfirmation(metrics=[]){
  const usable=metrics.filter(x=>Number.isFinite(x.ret5));
  if(!usable.length) return {score:0,crowding:0,breadth:0,quality:'LOW'};
  const breadth=usable.filter(x=>x.ret5>0).length/usable.length;
  const avg=(k)=>usable.reduce((a,x)=>a+(Number.isFinite(x[k])?x[k]:0),0)/usable.length;
  const r1=avg('ret1'), r5=avg('ret5'), r20=avg('ret20'), vz=avg('volumeZ');
  let score=0;
  if(breadth>=0.6) score+=20;
  if(r1>=1) score+=10;
  if(r5>=2) score+=20;
  if(r20>=4) score+=15;
  if(vz>=1) score+=15;
  if(usable.filter(x=>x.ret5>=2).length>=2) score+=10;
  const crowding=clamp(Math.max(0,r5*5)+Math.max(0,r20*2)+Math.max(0,vz*8));
  return {score:clamp(score),crowding,breadth:+breadth.toFixed(3),quality:usable.length>=3?'MEDIUM':'LOW',avg:{r1:+r1.toFixed(2),r5:+r5.toFixed(2),r20:+r20.toFixed(2),volumeZ:+vz.toFixed(2)}};
}

export function alphaClick({mechanismScore,marketScore,crowding,exposure=70,balance=60,catalyst=70,risk=40,sourceFamilies=0,sourceCount=0,invalidated=false}){
  const eligible=!invalidated && mechanismScore>=70 && marketScore>=25 && marketScore<=60 && crowding<70 && sourceFamilies>=2 && sourceCount>=2;
  const raw=.40*mechanismScore+.25*marketScore+.15*exposure+.10*balance+.10*catalyst-.25*crowding-.20*risk;
  return {eligible,score:+clamp(raw).toFixed(1),reason:eligible?'CAUSAL_EVIDENCE_PLUS_EARLY_MARKET_CONFIRMATION':'GATE_NOT_MET'};
}
