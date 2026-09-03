import fs from 'node:fs/promises';

const cfg=JSON.parse(await fs.readFile('config/mechanisms.json','utf8'));
const policy=JSON.parse(await fs.readFile('config/policy.v2.json','utf8'));
const tickers=[...new Set(cfg.mechanisms.flatMap(m=>[...(m.positive||[]),...(m.negative||[])]))];
const contextTickers=['^GSPC','^IXIC','^STOXX50E','BZ=F','CL=F','DX-Y.NYB','JPY=X','^TNX','XLE','ITA','QQQ','EWJ','XME','IWM','URA'];
const runId=process.env.GEARWATCH_RUN_ID||`run_${new Date().toISOString().replace(/[:.]/g,'-')}`;
const out={version:'2.3.0',run_id:runId,generated_at:new Date().toISOString(),provider:'Yahoo chart endpoint (best-effort, unauthenticated)',intraday:{interval:policy.market?.intraday_interval||'15m',range:policy.market?.intraday_range||'5d'},metrics:{},context:{},errors:[]};

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)))};
const ret=(a,n)=>a.length>n&&Number.isFinite(a[a.length-1-n])&&a[a.length-1-n]!==0?((a.at(-1)/a[a.length-1-n])-1)*100:null;
const sma=(a,n)=>a.length>=n?mean(a.slice(-n)):null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function chart(ticker,range,interval,includePrePost=false){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=${includePrePost?'true':'false'}&events=div%2Csplits`;
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 GearWatch/2.3'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const j=await r.json(),x=j?.chart?.result?.[0];if(!x)throw new Error('No chart result');return x;
}
function dailyMetric(x,ticker){
  const q=x.indicators?.quote?.[0]||{},pairs=(q.close||[]).map((c,i)=>({c,v:q.volume?.[i],t:x.timestamp?.[i]})).filter(z=>Number.isFinite(z.c)),closes=pairs.map(z=>z.c),vols=pairs.map(z=>Number.isFinite(z.v)?z.v:0);if(closes.length<21)throw new Error('Insufficient daily history');
  const recentVol=vols.slice(-60),volStd=sd(recentVol),volumeZ=volStd&&vols.length?((vols.at(-1)-mean(recentVol))/volStd):0,price=closes.at(-1),s20=sma(closes,20),s50=sma(closes,50),s200=sma(closes,200);
  return {ticker,asof:new Date((pairs.at(-1)?.t||Date.now()/1000)*1000).toISOString(),price:+price.toFixed(4),ret1:ret(closes,1)==null?null:+ret(closes,1).toFixed(2),ret5:ret(closes,5)==null?null:+ret(closes,5).toFixed(2),ret20:ret(closes,20)==null?null:+ret(closes,20).toFixed(2),volumeZ:+volumeZ.toFixed(2),sma20:s20==null?null:+s20.toFixed(4),sma50:s50==null?null:+s50.toFixed(4),sma200:s200==null?null:+s200.toFixed(4),above20:s20!=null?price>s20:null,above50:s50!=null?price>s50:null,above200:s200!=null?price>s200:null};
}
function intradayMetric(x){
  const q=x.indicators?.quote?.[0]||{},rows=(q.close||[]).map((c,i)=>({c,v:q.volume?.[i],t:x.timestamp?.[i]})).filter(z=>Number.isFinite(z.c)&&Number.isFinite(z.t));if(rows.length<3)return null;
  const closes=rows.map(z=>z.c),vols=rows.map(z=>Number.isFinite(z.v)?z.v:0),recentVol=vols.slice(-80),vs=sd(recentVol),volumeZ=vs?((vols.at(-1)-mean(recentVol))/vs):0,last26=rows.slice(-26),den=last26.reduce((a,z)=>a+(z.v||0),0),vwap=den?last26.reduce((a,z)=>a+z.c*(z.v||0),0)/den:null,price=closes.at(-1);
  const r30=ret(closes,2),r2=ret(closes,8),r1d=ret(closes,26);
  return {asof:new Date(rows.at(-1).t*1000).toISOString(),ret30m:r30==null?null:+r30.toFixed(2),ret2h:r2==null?null:+r2.toFixed(2),ret1d:r1d==null?null:+r1d.toFixed(2),volumeZ:+volumeZ.toFixed(2),vwap:vwap==null?null:+vwap.toFixed(4),aboveVwap:vwap==null?null:price>vwap,bars:rows.length};
}
async function one(ticker){
  const daily=await chart(ticker,'1y','1d',false),metric=dailyMetric(daily,ticker);await sleep(70);
  try{const intra=await chart(ticker,policy.market?.intraday_range||'5d',policy.market?.intraday_interval||'15m',true);metric.intraday=intradayMetric(intra)}catch(e){metric.intraday=null;metric.intraday_error=String(e.message||e)}
  return metric;
}

for(const ticker of [...tickers,...contextTickers]){
  try{const metric=await one(ticker);if(contextTickers.includes(ticker))out.context[ticker]=metric;else out.metrics[ticker]=metric}catch(e){out.errors.push({ticker,error:String(e.message||e)})}
  await sleep(90);
}

await fs.mkdir('data/market-history',{recursive:true});await fs.writeFile('data/market.json',JSON.stringify(out,null,2)+'\n');await fs.writeFile(`data/market-history/${runId}.json`,JSON.stringify(out,null,2)+'\n');
const intradayOk=[...Object.values(out.metrics),...Object.values(out.context)].filter(x=>x?.intraday&&Number.isFinite(x.intraday.ret2h)).length;
console.log(`market metrics: ${Object.keys(out.metrics).length}/${tickers.length}, context ${Object.keys(out.context).length}/${contextTickers.length}, intraday=${intradayOk}`);
