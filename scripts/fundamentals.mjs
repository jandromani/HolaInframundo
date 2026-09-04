import fs from 'node:fs/promises';

const seeds=JSON.parse(await fs.readFile('config/investment-seeds.json','utf8'));
const market=JSON.parse(await fs.readFile('data/market.json','utf8').catch(()=>'{"metrics":{}}'));
const path='data/fundamentals.json';
const prev=JSON.parse(await fs.readFile(path,'utf8').catch(()=>'{"companies":{}}'));
const now=new Date(),nowIso=now.toISOString(),TTL=7*24*3600*1000;
const symbols=[...new Set(Object.values(seeds.mechanisms||{}).flat().map(x=>x[0]))];
const secCandidates=symbols.filter(s=>!String(s).includes('.'));
const UA=process.env.SEC_USER_AGENT||'GearWatch/2.7 public research bot (github.com/jandromani)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out={version:'2.7.0',generated_at:nowIso,provider:'SEC companyfacts (cached, best-effort)',companies:{...prev.companies},coverage:{seed_symbols:symbols.length,sec_candidates:secCandidates.length,mapped:0,live:0,partial:0,structural_only:0,cache_hits:0,network_fetches:0},errors:[]};

async function getJson(url){const r=await fetch(url,{headers:{'user-agent':UA,'accept-encoding':'gzip, deflate'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`SEC ${r.status}`);return r.json()}
function fresh(x){const t=Date.parse(x?.checked_at||x?.generated_at||'');return Number.isFinite(t)&&Date.now()-t<TTL&&['LIVE_SEC','PARTIAL_SEC'].includes(x?.quality)}
function annualEntries(facts,tags,unit='USD'){
  for(const tag of tags){const node=facts?.['us-gaap']?.[tag],xs=node?.units?.[unit]||[];const rows=xs.filter(x=>['10-K','10-K/A','20-F','40-F'].includes(x.form)&&Number.isFinite(Number(x.val))).sort((a,b)=>String(b.end||'').localeCompare(String(a.end||''))||String(b.filed||'').localeCompare(String(a.filed||'')));const seen=new Set(),dedup=[];for(const x of rows){const k=x.end||`${x.fy}-${x.fp}`;if(seen.has(k))continue;seen.add(k);dedup.push(x)}if(dedup.length)return {tag,rows:dedup}}
  return {tag:null,rows:[]}
}
function latestAny(facts,namespace,tags,unit){for(const tag of tags){const xs=facts?.[namespace]?.[tag]?.units?.[unit]||[];const rows=xs.filter(x=>Number.isFinite(Number(x.val))).sort((a,b)=>String(b.end||'').localeCompare(String(a.end||''))||String(b.filed||'').localeCompare(String(a.filed||'')));if(rows.length)return {tag,row:rows[0]}}return {tag:null,row:null}}
function latestVal(facts,tags){const a=annualEntries(facts,tags);return {tag:a.tag,value:a.rows[0]?.val??null,prev:a.rows[1]?.val??null,end:a.rows[0]?.end??null,prev_end:a.rows[1]?.end??null}}
function debtVal(facts){
  const pairs=[['LongTermDebtCurrent','LongTermDebtNoncurrent'],['LongTermDebtAndFinanceLeaseObligationsCurrent','LongTermDebtAndFinanceLeaseObligationsNoncurrent']];
  for(const pair of pairs){const a=latestVal(facts,[pair[0]]),b=latestVal(facts,[pair[1]]);if(Number.isFinite(Number(a.value))||Number.isFinite(Number(b.value)))return {value:(Number(a.value)||0)+(Number(b.value)||0),tags:pair.filter((_,i)=>i===0?a.tag:b.tag),end:a.end||b.end}}
  const x=latestVal(facts,['LongTermDebtAndFinanceLeaseObligations','LongTermDebt','LongTermDebtNoncurrent']);return {value:x.value,tags:x.tag?[x.tag]:[],end:x.end}
}
function parseFacts(j,symbol,title,cik){const facts=j.facts||{},rev=latestVal(facts,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']),op=latestVal(facts,['OperatingIncomeLoss']),cfo=latestVal(facts,['NetCashProvidedByUsedInOperatingActivities']),capex=latestVal(facts,['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsForAdditionsToPropertyPlantAndEquipment']),assets=latestVal(facts,['Assets']),liab=latestVal(facts,['Liabilities']),cash=latestVal(facts,['CashAndCashEquivalentsAtCarryingValue','CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents']),interest=latestVal(facts,['InterestExpenseNonOperating','InterestAndDebtExpense']),debt=debtVal(facts),shares=latestAny(facts,'dei',['EntityCommonStockSharesOutstanding'],'shares');const fin={revenue:rev.value,revenue_prev:rev.prev,operating_income:op.value,operating_income_prev:op.prev,cfo:cfo.value,capex:capex.value,assets:assets.value,liabilities:liab.value,cash:cash.value,debt:debt.value,interest_expense:interest.value,shares:shares.row?.val??null};const required=['revenue','operating_income','cfo','capex','assets','liabilities','cash','debt'],n=required.filter(k=>Number.isFinite(Number(fin[k]))).length,quality=n>=6?'LIVE_SEC':n>=2?'PARTIAL_SEC':'STRUCTURAL_ONLY',price=market.metrics?.[symbol]?.price??null,marketCap=Number.isFinite(Number(fin.shares))&&Number.isFinite(Number(price))?Number(fin.shares)*Number(price):null;return {symbol,name:j.entityName||title,cik:String(cik).padStart(10,'0'),checked_at:nowIso,quality,coverage:+(n/required.length).toFixed(3),price,market_cap:Number.isFinite(marketCap)?Math.round(marketCap):null,period_end:rev.end||op.end||assets.end||null,financials:fin,tags:{revenue:rev.tag,operating_income:op.tag,cfo:cfo.tag,capex:capex.tag,assets:assets.tag,liabilities:liab.tag,cash:cash.tag,debt:debt.tags,interest:interest.tag,shares:shares.tag}}}

let tickerMap={};
try{
  const raw=await getJson('https://www.sec.gov/files/company_tickers.json');
  tickerMap=Object.fromEntries(Object.values(raw||{}).map(x=>[String(x.ticker||'').toUpperCase(),x]));
}catch(e){out.errors.push({scope:'ticker_map',error:String(e.message||e)})}

for(const symbol of secCandidates){
  if(fresh(prev.companies?.[symbol])){out.companies[symbol]=prev.companies[symbol];out.coverage.cache_hits++;continue}
  const row=tickerMap[String(symbol).toUpperCase()];
  if(!row){out.companies[symbol]={symbol,checked_at:nowIso,quality:'STRUCTURAL_ONLY',coverage:0,error:'Ticker not mapped by SEC'};continue}
  out.coverage.mapped++;
  try{
    const cik=String(row.cik_str).padStart(10,'0');const j=await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);out.companies[symbol]=parseFacts(j,symbol,row.title,cik);out.coverage.network_fetches++;
  }catch(e){
    const cached=prev.companies?.[symbol];if(cached&&['LIVE_SEC','PARTIAL_SEC'].includes(cached.quality)){out.companies[symbol]={...cached,stale:true,last_error:String(e.message||e)}}else out.companies[symbol]={symbol,name:row.title,cik:String(row.cik_str).padStart(10,'0'),checked_at:nowIso,quality:'STRUCTURAL_ONLY',coverage:0,error:String(e.message||e)};out.errors.push({symbol,error:String(e.message||e)})
  }
  await sleep(140);
}
for(const symbol of symbols.filter(s=>String(s).includes('.')))if(!out.companies[symbol])out.companies[symbol]={symbol,checked_at:nowIso,quality:'STRUCTURAL_ONLY',coverage:0,reason:'Non-US exchange: deterministic structural priors used until a standardized filing source is added.'};

out.coverage.live=Object.values(out.companies).filter(x=>x.quality==='LIVE_SEC').length;out.coverage.partial=Object.values(out.companies).filter(x=>x.quality==='PARTIAL_SEC').length;out.coverage.structural_only=Object.values(out.companies).filter(x=>x.quality==='STRUCTURAL_ONLY').length;
await fs.writeFile(path,JSON.stringify(out,null,2)+'\n');
console.log(`fundamentals: live=${out.coverage.live} partial=${out.coverage.partial} structural=${out.coverage.structural_only} cache=${out.coverage.cache_hits} fetched=${out.coverage.network_fetches} errors=${out.errors.length}`);
