export const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(Number(x))?Number(x):a));
export const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const num=v=>finite(v)?Number(v):null;
const round=(v,d=2)=>finite(v)?+Number(v).toFixed(d):null;

export function calendarReturn(points,days){
  const rows=(points||[]).filter(x=>finite(x?.c)&&finite(x?.t)).sort((a,b)=>a.t-b.t);
  if(rows.length<2)return null;
  const last=rows.at(-1),target=Number(last.t)-Number(days)*86400;
  let base=rows[0];
  for(const row of rows){if(row.t<=target)base=row;else break}
  if(!finite(base?.c)||Number(base.c)===0||base===last)return null;
  return round((Number(last.c)/Number(base.c)-1)*100);
}

export function rangeStats(points){
  const rows=(points||[]).filter(x=>finite(x?.c)).slice(-260),vals=rows.map(x=>Number(x.c));
  if(!vals.length)return {high52:null,low52:null,drawdown52:null};
  const price=vals.at(-1),high=Math.max(...vals),low=Math.min(...vals);
  return {high52:round(high,4),low52:round(low,4),drawdown52:high>0?round((price/high-1)*100):null};
}

export function fundamentalMetrics(fundamental={},price=null){
  const x=fundamental?.financials||fundamental||{},px=num(price??fundamental?.price),shares=num(x.shares),sharesPrev=num(x.shares_prev),cash=num(x.cash),debt=num(x.debt),ebitda=num(x.ebitda),fcf=num(x.free_cash_flow),marketCap=num(fundamental?.market_cap)??(shares&&px?shares*px:null),netDebt=debt!==null&&cash!==null?debt-cash:null,ev=marketCap!==null&&netDebt!==null?marketCap+netDebt:null;
  return {
    market_cap:marketCap==null?null:Math.round(marketCap),
    free_cash_flow:fcf==null?null:Math.round(fcf),
    fcf_yield:marketCap&&fcf!==null?round(fcf/marketCap*100):null,
    net_debt:netDebt==null?null:Math.round(netDebt),
    net_debt_to_ebitda:ebitda&&ebitda>0&&netDebt!==null?round(netDebt/ebitda):null,
    ev_to_ebitda:ebitda&&ebitda>0&&ev!==null?round(ev/ebitda):null,
    dilution_yoy:sharesPrev&&sharesPrev>0&&shares!==null?round((shares/sharesPrev-1)*100):null,
    ebitda:ebitda==null?null:Math.round(ebitda)
  };
}

function fcfScore(v){if(v==null)return 48;if(v<0)return 18;if(v<2)return 42;if(v<5)return 62;if(v<9)return 78;return 88}
function leverageScore(v){if(v==null)return 50;if(v<=0)return 92;if(v<=1)return 84;if(v<=2)return 72;if(v<=3)return 58;if(v<=4)return 42;return 22}
function valuationScore(v){if(v==null)return 50;if(v<=7)return 84;if(v<=11)return 74;if(v<=16)return 62;if(v<=22)return 48;if(v<=30)return 36;return 24}
function dilutionScore(v){if(v==null)return 48;if(v<=0)return 82;if(v<=2)return 72;if(v<=5)return 58;if(v<=10)return 40;return 22}

export function companyEntryAnalytics({causal=0,pricedIn=0,wave='DISCOVERY',transmission=50,financialPass=50,market={},fundamental={}}={}){
  const fm=fundamentalMetrics(fundamental,market?.price),ret30=num(market?.ret30),ret90=num(market?.ret90),drawdown=num(market?.drawdown52),above20=market?.above20,above50=market?.above50,above200=market?.above200;
  const financialQuality=Math.round(clamp(.30*fcfScore(fm.fcf_yield)+.25*leverageScore(fm.net_debt_to_ebitda)+.18*valuationScore(fm.ev_to_ebitda)+.12*dilutionScore(fm.dilution_yoy)+.15*clamp(financialPass)));
  const causalEdge=Math.round(clamp(50+(Number(causal||0)-Number(pricedIn||0))*1.25));
  const trend=[above20,above50,above200].reduce((s,x)=>s+(x===true?8:x===false?-5:0),50);
  let marketSetup=clamp(trend);
  if(drawdown!==null&&drawdown<=-6&&drawdown>=-28)marketSetup+=8;
  if(drawdown!==null&&drawdown>-3)marketSetup-=8;
  let chasePenalty=0,fallingKnifePenalty=0;
  if(ret30!==null&&ret30>15)chasePenalty+=Math.min(18,(ret30-15)*.7);
  if(ret90!==null&&ret90>35)chasePenalty+=Math.min(18,(ret90-35)*.35);
  if(['LATE_WAVE','SATURATED'].includes(String(wave)))chasePenalty+=18;
  if(ret30!==null&&ret30<-18&&above200===false)fallingKnifePenalty+=12;
  if(ret90!==null&&ret90<-30&&above50===false)fallingKnifePenalty+=8;
  marketSetup=Math.round(clamp(marketSetup-chasePenalty-fallingKnifePenalty));
  const blind=[];
  if(fm.fcf_yield==null)blind.push('FCF_YIELD');
  if(fm.net_debt_to_ebitda==null)blind.push('NET_DEBT_EBITDA');
  if(fm.ev_to_ebitda==null)blind.push('EV_EBITDA');
  if(fm.dilution_yoy==null)blind.push('DILUTION_YOY');
  for(const [key,val] of [['RET_7D',market?.ret7],['RET_30D',market?.ret30],['RET_90D',market?.ret90],['RET_180D',market?.ret180],['DRAWDOWN_52W',market?.drawdown52]])if(!finite(val))blind.push(key);
  blind.push('EARNINGS_REVISIONS','INSIDER_FLOWS','INSTITUTIONAL_FLOWS');
  const coverage=Math.round(clamp(100-blind.length*7));
  const score=Math.round(clamp(.34*causalEdge+.29*financialQuality+.20*marketSetup+.17*clamp(transmission)-chasePenalty*.35-fallingKnifePenalty*.4));
  let verdict=score>=76?'ATTRACTIVE_SETUP':score>=64?'SELECTIVE_SETUP':score>=52?'WATCH':'LOW_PRIORITY';
  if(chasePenalty>=18)verdict='DO_NOT_CHASE';
  if(fm.fcf_yield!==null&&fm.fcf_yield<0&&fm.net_debt_to_ebitda!==null&&fm.net_debt_to_ebitda>3.5)verdict='HIGH_RISK';
  return {entry_quality_score:score,verdict,causal_edge_score:causalEdge,financial_quality_score:financialQuality,market_setup_score:marketSetup,coverage_score:coverage,chase_penalty:round(chasePenalty,1),falling_knife_penalty:round(fallingKnifePenalty,1),fundamentals:fm,blind_sensors:[...new Set(blind)]};
}
