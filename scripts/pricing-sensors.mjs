import fs from 'node:fs/promises';

const cfg=JSON.parse(await fs.readFile('config/pricing-sensors.json','utf8'));
const now=new Date(),clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,Number(x)||0));
const timeout=ms=>AbortSignal.timeout(ms);
const observations={};
function put(source,data){observations[source]={source,family:cfg.sources[source]?.family||'UNKNOWN',observed_at:now.toISOString(),...data}}

async function acer(){
 try{
  const r=await fetch(cfg.sources.ACER_LNG.url,{headers:{'user-agent':'GearWatch/4.2 research sensor'},signal:timeout(15000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);const h=await r.text();
  const rows=[...h.matchAll(/(20\d{2}\.\d{2}\.\d{2})[\s\S]{0,900}?([0-9]{2,3}\.[0-9]{3})[\s\S]{0,250}?([0-9]{2,3}\.[0-9]{3})[\s\S]{0,250}?([0-9]{2,3}\.[0-9]{3})[\s\S]{0,250}?(-?[0-9]{1,2}\.[0-9]{3})/g)].map(m=>({date:m[1],nwe:+m[2],south:+m[3],eu:+m[4],benchmark:+m[5]}));
  if(!rows.length)throw new Error('no ACER rows parsed');const latest=rows[0],base=rows[Math.min(rows.length-1,10)],pct=base?.eu?((latest.eu/base.eu)-1)*100:0;
  const score=Math.round(clamp(50+pct*3));put('ACER_LNG',{status:'OK',quality:'PRIMARY_OFFICIAL',value:latest.eu,unit:'EUR/MWh',benchmark_spread:latest.benchmark,change_window_pct:+pct.toFixed(2),pricing_score:score,sample:rows.slice(0,15)});
 }catch(e){put('ACER_LNG',{status:'ERROR',error:String(e.message||e),pricing_score:null})}
}

const predictionTerms={
 JAPAN_CARRY_UNWIND:['japan','yen','boj','jgb'],GLOBAL_REFINANCING_STRESS:['recession','default','credit','rates'],ARSENAL_DEPLETION:['war','ukraine','iran','defense'],CHEAP_DRONE_SCALING:['drone','war'],UNDERWATER_SECURITY:['hormuz','shipping','iran'],OT_CYBER_SHOCK:['cyber','outage'],LNG_REROUTING:['lng','gas','hormuz']
};
async function kalshi(){
 try{
  const base=cfg.sources.KALSHI.url;const r=await fetch(`${base}/markets?limit=1000&status=open`,{signal:timeout(15000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);const j=await r.json(),markets=j.markets||[];const mapped={};
  for(const [id,terms] of Object.entries(predictionTerms)){
   const hits=markets.filter(x=>terms.some(t=>`${x.title||''} ${x.subtitle||''} ${x.ticker||''}`.toLowerCase().includes(t))).slice(0,12).map(x=>({ticker:x.ticker,title:x.title,last_price:Number(x.last_price_dollars??x.last_price??x.yes_bid_dollars??x.yes_bid),volume:Number(x.volume_fp??x.volume??0),open_interest:Number(x.open_interest_fp??x.open_interest??0)}));
   const probs=hits.map(x=>x.last_price).filter(x=>Number.isFinite(x)&&x>=0&&x<=1);mapped[id]={hits,pricing_score:probs.length?Math.round(clamp(probs.reduce((a,b)=>a+b,0)/probs.length*100)):null};
  }
  put('KALSHI',{status:'OK',quality:'PREDICTION_PUBLIC',market_count:markets.length,mechanisms:mapped});
 }catch(e){put('KALSHI',{status:'ERROR',error:String(e.message||e)})}
}

async function ais(){
 const key=process.env.AISSTREAM_API_KEY;if(!key){put('AISSTREAM',{status:'NOT_CONFIGURED',quality:'PRIMARY_PHYSICAL',error:'AISSTREAM_API_KEY missing'});return}
 try{
  const vessels=new Map();await new Promise((resolve,reject)=>{const ws=new WebSocket(cfg.sources.AISSTREAM.url);const timer=setTimeout(()=>{try{ws.close()}catch{}resolve()},18000);ws.onopen=()=>ws.send(JSON.stringify({APIKey:key,BoundingBoxes:[[[25.3,55.0],[27.4,57.5]]]}));ws.onerror=()=>{clearTimeout(timer);reject(new Error('AIS websocket error'))};ws.onmessage=e=>{try{const x=JSON.parse(e.data),m=x.MetaData||{},msg=x.Message?.PositionReport||x.Message?.StandardClassBPositionReport;if(m.MMSI&&msg)vessels.set(String(m.MMSI),{mmsi:m.MMSI,name:m.ShipName||null,lat:m.latitude||m.Latitude||msg.Latitude,lon:m.longitude||m.Longitude||msg.Longitude,sog:msg.Sog??null})}catch{}};ws.onclose=()=>{clearTimeout(timer);resolve()}});
  put('AISSTREAM',{status:'OK',quality:'PRIMARY_PHYSICAL',area:'STRAIT_OF_HORMUZ',unique_vessels:vessels.size,pricing_score:null,note:'Raw density only. Score remains null until GearWatch accumulates a rolling transit baseline.',sample:[...vessels.values()].slice(0,30)});
 }catch(e){put('AISSTREAM',{status:'ERROR',error:String(e.message||e),pricing_score:null})}
}

await Promise.all([acer(),kalshi(),ais()]);
const mechanisms={};
for(const [id,sources] of Object.entries(cfg.mechanisms||{})){
 const rows=sources.map(source=>{const o=observations[source],score=source==='KALSHI'?o?.mechanisms?.[id]?.pricing_score:o?.pricing_score;return {source,family:cfg.sources[source]?.family,access:cfg.sources[source]?.access,status:o?.status||cfg.sources[source]?.status||'UNOBSERVED',score:Number.isFinite(score)?score:null}});
 const scored=rows.filter(x=>Number.isFinite(x.score));mechanisms[id]={sources:rows,primary_priced_in:scored.length?Math.round(scored.reduce((a,x)=>a+x.score,0)/scored.length):null,pricing_confidence:Math.round(clamp(scored.length/Math.max(2,rows.filter(x=>!['PAID'].includes(x.access)).length)*100)),observed_sources:scored.length,total_sources:rows.length};
}
const out={version:'4.2.0',generated_at:now.toISOString(),observations,mechanisms,coverage:{mechanisms:Object.keys(mechanisms).length,live_sources:Object.values(observations).filter(x=>x.status==='OK').length,configured_sources:Object.keys(cfg.sources).length}};
await fs.writeFile('data/pricing-sensors.json',JSON.stringify(out,null,2)+'\n');console.log(`pricing sensors v4.2: live=${out.coverage.live_sources}/${out.coverage.configured_sources}`);
