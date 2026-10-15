// Canary-001 forward-only evaluator: no live orders, no invented quotes, no premarket as entry.
import fs from 'node:fs/promises';
import {measureMarketOutcome} from '../lib/canary-001-judge.mjs';
const path='data/experiments/CANARY-001.observations.json';
const prereg=JSON.parse(await fs.readFile('experiments/CANARY-001.preregistered.json','utf8'));
if(prereg.status!=='PREREGISTERED_RESEARCH_ONLY'||prereg.preregistered_claims?.market?.entry_rule!=='FIRST_NEXT_REGULAR_SESSION_OPEN_AFTER_GIT_PREREGISTRATION')throw new Error('Canary preregistration schema mismatch');
const get=async ticker=>{
 const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(ticker)+'?range=3mo&interval=1d&events=div%2Csplits';
 const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 GearWatchCanary-001/1.0','Accept':'application/json'},
  signal:AbortSignal.timeout(16000)});
 if(!r.ok)throw new Error(ticker+' HTTP '+r.status);
 const j=await r.json();
 const chart=j.chart?.result?.[0];
 if(!chart?.timestamp?.length)throw new Error(ticker+' no chart bars');
 const q=chart.indicators?.quote?.[0]||{};
 const bars=chart.timestamp.map((t,i)=>{
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'})
   .format(new Date(t*1000));
  return {date,open:q.open?.[i],close:q.close?.[i],volume:q.volume?.[i]};
 });
 return {url,source:'Yahoo Chart historical daily OHLC',bars};
};
const today=new Date();
const prev=JSON.parse(await fs.readFile(path,'utf8').catch(()=>JSON.stringify({
 experiment_id:prereg.experiment_id,schema_version:'1.0.0',baseline_proof:'experiments/CANARY-001.preregistered.json',
 status:'WAITING_ENTRY',assessments:[],earnings_evidence:[],supply_evidence:[]
})));
if(prev.experiment_id!==prereg.experiment_id)throw new Error('Refusing to overwrite different Canary experiment');
let assessment;
try{
 const [lxu,cf]=await Promise.all([get('LXU'),get('CF')]);
 assessment=measureMarketOutcome({lxu:lxu.bars,cf:cf.bars,
  referenceClose:prereg.frozen_price_reference.price_usd.LXU_regular_close,thresholdPp:5,now:today});
 assessment.provider_sources={LXU:lxu.url,CF:cf.url};
 assessment.updated_at=today.toISOString();
 assessment.earnings_status='NOT_VERIFIED_BY_THIS_MARKET_SCRIPT';
 assessment.physical_status='NOT_VERIFIED_BY_THIS_MARKET_SCRIPT';
 assessment.result_status='INCONCLUSIVE_UNTIL_PHYSICAL_AND_COMPANY_EVIDENCE';
}catch(e){
 assessment={status:'MARKET_DATA_UNAVAILABLE',updated_at:today.toISOString(),
  error:String(e?.message||e).slice(0,350),horizons:[],entry:null,
  note:'Do not use stale prices or proxy values; retry on the next scan'};
}
const last=prev.assessments?.at(-1)||null;
const signature=JSON.stringify({status:assessment.status,entry:assessment.entry,
  horizons:assessment.horizons,latest:assessment.latest_common_session});
const priorSignature=last?JSON.stringify({status:last.status,entry:last.entry,
  horizons:last.horizons,latest:last.latest_common_session}):null;
if(signature!==priorSignature){
 prev.assessments.push(assessment);
 prev.assessments=prev.assessments.slice(-90);
}
prev.status=assessment.status;
prev.last_checked_at=today.toISOString();
prev.result_status='NOT_YET_ADJUDICATED';
prev.real_money_orders=false;
await fs.mkdir('data/experiments',{recursive:true});
await fs.writeFile(path,JSON.stringify(prev,null,2)+'\n');
console.log('Canary-001: '+assessment.status+' · '+(assessment.latest_common_session||'no common observed session')+
 ' · research only, no brokerage orders');
