import fs from 'node:fs/promises';

const seeds=JSON.parse(await fs.readFile('config/investment-seeds.json','utf8'));
const market=JSON.parse(await fs.readFile('data/market.json','utf8').catch(()=>'{"metrics":{}}'));
const path='data/fundamentals.json';
const prev=JSON.parse(await fs.readFile(path,'utf8').catch(()=>'{"companies":{}}'));
const now=new Date(),nowIso=now.toISOString(),TTL=3*24*3600*1000;
const symbols=[...new Set(Object.values(seeds.mechanisms||{}).flat().map(x=>x[0]))];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const TYPES={
  revenue:['annualTotalRevenue','annualOperatingRevenue'],
  operating_income:['annualOperatingIncome','annualTotalOperatingIncomeAsReported'],
  cfo:['annualOperatingCashFlow','annualCashFlowFromContinuingOperatingActivities'],
  capex:['annualCapitalExpenditure','annualCapitalExpenditureReported'],
  assets:['annualTotalAssets'],
  liabilities:['annualTotalLiabilitiesNetMinorityInterest'],
  cash:['annualCashCashEquivalentsAndShortTermInvestments','annualCashAndCashEquivalents'],
  debt:['annualTotalDebt','annualNetDebt'],
  shares:['annualDilutedAverageShares','annualBasicAverageShares'],
  free_cash_flow:['annualFreeCashFlow'],
  ebitda:['annualEBITDA','annualNormalizedEBITDA']
};
const requested=[...new Set(Object.values(TYPES).flat())];
const out={version:'2.8.0',generated_at:nowIso,provider:'Yahoo fundamentals-timeseries (cached, unauthenticated) with deterministic fallback',companies:{...prev.companies},coverage:{seed_symbols:symbols.length,live:0,partial:0,structural_only:0,cache_hits:0,network_fetches:0,network_errors:0},errors:[]};

const fresh=x=>{const t=Date.parse(x?.checked_at||x?.generated_at||'');return Number.isFinite(t)&&Date.now()-t<TTL&&['LIVE_YAHOO','PARTIAL_YAHOO','LIVE_SEC','PARTIAL_SEC'].includes(x?.quality)};
const rawVal=x=>Number.isFinite(Number(x?.reportedValue?.raw))?Number(x.reportedValue.raw):Number.isFinite(Number(x?.reportedValue))?Number(x.reportedValue):null;
const when=x=>Date.parse(x?.asOfDate||x?.reportedDate||x?.date||'')||0;
function series(result,type){
  const node=(result||[]).find(x=>Array.isArray(x?.[type])||x?.meta?.type?.includes?.(type));
  return (node?.[type]||[]).filter(x=>rawVal(x)!=null).sort((a,b)=>when(b)-when(a));
}
function select(result,aliases){for(const type of aliases){const xs=series(result,type);if(xs.length)return {type,xs}}return {type:null,xs:[]}}
function point(result,aliases){const s=select(result,aliases);return {type:s.type,value:rawVal(s.xs[0]),prev:rawVal(s.xs[1]),end:s.xs[0]?.asOfDate||null,prev_end:s.xs[1]?.asOfDate||null}}
function yahooUrl(symbol){
  const q=new URLSearchParams({symbol,padTimeSeries:'true',period1:String(Math.floor((Date.now()-8*365.25*24*3600*1000)/1000)),period2:String(Math.floor((Date.now()+24*3600*1000)/1000))});
  for(const t of requested)q.append('type',t);
  return `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?${q.toString()}`;
}
async function fetchYahoo(symbol){
  const r=await fetch(yahooUrl(symbol),{headers:{'user-agent':'Mozilla/5.0 GearWatch/2.8','accept':'application/json','referer':`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/financials`},signal:AbortSignal.timeout(22000)});
  if(!r.ok)throw new Error(`Yahoo fundamentals HTTP ${r.status}`);
  const j=await r.json();if(j?.finance?.error)throw new Error(`Yahoo fundamentals ${j.finance.error.code||'error'}`);const result=j?.timeseries?.result||[];if(!Array.isArray(result)||!result.length)throw new Error('Yahoo fundamentals empty result');return result;
}
function parseYahoo(result,symbol){
  const revenue=point(result,TYPES.revenue),op=point(result,TYPES.operating_income),cfo=point(result,TYPES.cfo),capex=point(result,TYPES.capex),assets=point(result,TYPES.assets),liabilities=point(result,TYPES.liabilities),cash=point(result,TYPES.cash),debt=point(result,TYPES.debt),shares=point(result,TYPES.shares),fcf=point(result,TYPES.free_cash_flow),ebitda=point(result,TYPES.ebitda);
  const fin={revenue:revenue.value,revenue_prev:revenue.prev,operating_income:op.value,operating_income_prev:op.prev,cfo:cfo.value,capex:capex.value,assets:assets.value,liabilities:liabilities.value,cash:cash.value,debt:debt.value,shares:shares.value,free_cash_flow:fcf.value,ebitda:ebitda.value};
  const required=['revenue','operating_income','cfo','capex','assets','liabilities','cash','debt'],n=required.filter(k=>Number.isFinite(Number(fin[k]))).length,coverage=n/required.length,quality=n>=6?'LIVE_YAHOO':n>=2?'PARTIAL_YAHOO':'STRUCTURAL_ONLY';
  const price=market.metrics?.[symbol]?.price??null,marketCap=Number.isFinite(Number(fin.shares))&&Number.isFinite(Number(price))?Number(fin.shares)*Number(price):null;
  return {symbol,name:symbol,checked_at:nowIso,quality,coverage:+coverage.toFixed(3),price,market_cap:Number.isFinite(marketCap)?Math.round(marketCap):null,period_end:revenue.end||op.end||assets.end||null,financials:fin,tags:{revenue:revenue.type,operating_income:op.type,cfo:cfo.type,capex:capex.type,assets:assets.type,liabilities:liabilities.type,cash:cash.type,debt:debt.type,shares:shares.type,free_cash_flow:fcf.type,ebitda:ebitda.type}};
}

for(const symbol of symbols){
  if(fresh(prev.companies?.[symbol])){out.companies[symbol]=prev.companies[symbol];out.coverage.cache_hits++;continue}
  try{const result=await fetchYahoo(symbol);out.companies[symbol]=parseYahoo(result,symbol);out.coverage.network_fetches++}
  catch(e){
    const cached=prev.companies?.[symbol];const msg=String(e.message||e);out.coverage.network_errors++;out.errors.push({symbol,error:msg});
    if(cached&&['LIVE_YAHOO','PARTIAL_YAHOO','LIVE_SEC','PARTIAL_SEC'].includes(cached.quality))out.companies[symbol]={...cached,stale:true,last_error:msg};
    else out.companies[symbol]={symbol,checked_at:nowIso,quality:'STRUCTURAL_ONLY',coverage:0,error:msg};
  }
  await sleep(95);
}

const vals=Object.values(out.companies);out.coverage.live=vals.filter(x=>['LIVE_YAHOO','LIVE_SEC'].includes(x.quality)).length;out.coverage.partial=vals.filter(x=>['PARTIAL_YAHOO','PARTIAL_SEC'].includes(x.quality)).length;out.coverage.structural_only=vals.filter(x=>x.quality==='STRUCTURAL_ONLY').length;
await fs.writeFile(path,JSON.stringify(out,null,2)+'\n');
console.log(`fundamentals: live=${out.coverage.live} partial=${out.coverage.partial} structural=${out.coverage.structural_only} cache=${out.coverage.cache_hits} fetched=${out.coverage.network_fetches} errors=${out.coverage.network_errors}`);
