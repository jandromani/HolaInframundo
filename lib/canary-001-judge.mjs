// Deterministic Canary-001 assessor. Never rewrites the signed preregistered hypothesis.
// The first next-session regular-market open is fixed BEFORE seeing future closes.
// Price evidence is distinct from physical evidence and corporate income statements.
export function nyDate(ts){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts));
}
export function isNyCloseFinal(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
  hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
 const hour=Number(parts.find(p=>p.type==='hour')?.value);
 const minute=Number(parts.find(p=>p.type==='minute')?.value);
 return hour>16 || (hour===16&&minute>=10);
}
const validPrice=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function sanitizeBars(bars,now=new Date()){
 const today=nyDate(now),final=isNyCloseFinal(now);
 return (Array.isArray(bars)?bars:[])
  .filter(b=>typeof b.date==='string'&&b.date>='2026-10-16'&&
   (b.date<today||(b.date===today&&final))&&validPrice(b.open)&&validPrice(b.close))
  .map(b=>({date:b.date,open:b.open,close:b.close,volume:b.volume??null}))
  .sort((a,b)=>a.date.localeCompare(b.date))
  .filter((b,i,a)=>i===0||b.date!==a[i-1].date);
}
export function measureMarketOutcome({lxu=[],cf=[],referenceClose=10.46,thresholdPp=5,now=new Date()}){
 const aa=sanitizeBars(lxu,now),bb=sanitizeBars(cf,now);
 const cfByDate=new Map(bb.map(b=>[b.date,b]));
 const aligned=aa.filter(a=>cfByDate.has(a.date)).map(a=>({date:a.date,LXU:a,CF:cfByDate.get(a.date)}));
 const first=aligned.find(x=>x.date>='2026-10-16');
 if(!first)return {status:'WAITING_ENTRY',entry:null,horizons:[],note:'Regular-session entry open not yet observed on both tickers.'};
 if(first.date!=='2026-10-16')return {status:'ENTRY_SESSION_MISSING',entry:null,horizons:[],note:'Oct 16 entry bar was not observed. No retrospective replacement with a later open is permitted.'};
 const idx=aligned.indexOf(first);
 const future=aligned.slice(idx);
 const gapPct=(first.LXU.open/referenceClose-1)*100;
 const moved=gapPct>=8;
 const entry={session:first.date,lxu_open_usd:first.LXU.open,cf_open_usd:first.CF.open,previous_close_reference_usd:referenceClose,
  gap_pct:+gapPct.toFixed(4),gap_already_moved:moved};
 const horizons=[5,10,20].map(n=>{
  const end=future[n];
  if(!end)return {sessions_after_entry:n,status:'PENDING',date:null};
  const lxuRet=(end.LXU.close/first.LXU.open-1)*100;
  const cfRet=(end.CF.close/first.CF.open-1)*100;
  const alpha=lxuRet-cfRet;
  return {sessions_after_entry:n,status:'OBSERVED',end_date:end.date,
   LXU_return_pct:+lxuRet.toFixed(4),CF_return_pct:+cfRet.toFixed(4),
   alpha_vs_CF_pp:+alpha.toFixed(4),
   market_rule_met:alpha>=thresholdPp&&lxuRet>0};
 });
 const last=horizons.at(-1);
 return {status:last.status==='PENDING'?(moved?'ALREADY_MOVED_ENTRY':'AWAITING_20_SESSIONS'):
  moved?'ALREADY_MOVED_ENTRY':last.market_rule_met?'MARKET_CONDITION_MET_NOT_CAUSAL_PROOF':'MARKET_CONDITION_FAILED',
  entry,latest_common_session:future.at(-1).date,observed_joint_sessions:future.length,horizons,
  note:'Causal confirmation requires separate primary evidence and earnings bridge. Market outperformance alone is not causal proof.'};
}
