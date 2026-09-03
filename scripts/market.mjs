import fs from 'node:fs/promises';

const cfg=JSON.parse(await fs.readFile('config/mechanisms.json','utf8'));
const tickers=[...new Set(cfg.mechanisms.flatMap(m=>[...(m.positive||[]),...(m.negative||[])]))];
const contextTickers=['^GSPC','^IXIC','^STOXX50E','BZ=F','CL=F','DX-Y.NYB','JPY=X','^TNX'];
const runId=process.env.GEARWATCH_RUN_ID||`run_${new Date().toISOString().replace(/[:.]/g,'-')}`;
const out={version:'2.0.0',run_id:runId,generated_at:new Date().toISOString(),provider:'Yahoo chart endpoint (best-effort, unauthenticated)',metrics:{},context:{},errors:[]};

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)))};
const ret=(a,n)=>a.length>n&&a[a.length-1-n]?((a.at(-1)/a[a.length-1-n])-1)*100:null;
const sma=(a,n)=>a.length>=n?mean(a.slice(-n)):null;

async function one(ticker){
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&events=div%2Csplits`;
  const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 GearWatch/2.0'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const j=await r.json();const x=j?.chart?.result?.[0];if(!x)throw new Error('No chart result');
  const q=x.indicators?.quote?.[0]||{};const closes=(q.close||[]).filter(Number.isFinite),vols=(q.volume||[]).filter(Number.isFinite);if(closes.length<21)throw new Error('Insufficient history');
  const recentVol=vols.slice(-60),volStd=sd(recentVol),volumeZ=volStd&&vols.length?((vols.at(-1)-mean(recentVol))/volStd):0;
  const price=closes.at(-1),s20=sma(closes,20),s50=sma(closes,50),s200=sma(closes,200);
  return {asof:new Date((x.timestamp?.at(-1)||Date.now()/1000)*1000).toISOString(),price:+price.toFixed(4),ret1:ret(closes,1)==null?null:+ret(closes,1).toFixed(2),ret5:ret(closes,5)==null?null:+ret(closes,5).toFixed(2),ret20:ret(closes,20)==null?null:+ret(closes,20).toFixed(2),volumeZ:+volumeZ.toFixed(2),sma20:s20==null?null:+s20.toFixed(4),sma50:s50==null?null:+s50.toFixed(4),sma200:s200==null?null:+s200.toFixed(4),above20:s20!=null?price>s20:null,above50:s50!=null?price>s50:null,above200:s200!=null?price>s200:null};
}

for(const ticker of [...tickers,...contextTickers]){
  try{const metric=await one(ticker);if(contextTickers.includes(ticker))out.context[ticker]=metric;else out.metrics[ticker]=metric}catch(e){out.errors.push({ticker,error:String(e.message||e)})}
  await new Promise(r=>setTimeout(r,140));
}

await fs.mkdir('data/market-history',{recursive:true});await fs.writeFile('data/market.json',JSON.stringify(out,null,2)+'\n');await fs.writeFile(`data/market-history/${runId}.json`,JSON.stringify(out,null,2)+'\n');
console.log(`market metrics: ${Object.keys(out.metrics).length}/${tickers.length}, context ${Object.keys(out.context).length}/${contextTickers.length}`);
