import fs from 'node:fs/promises';

const series=JSON.parse(await fs.readFile('data/series.json','utf8').catch(()=>'{"points":[]}')).points||[];
const ledger=JSON.parse(await fs.readFile('data/alpha-clicks.json','utf8').catch(()=>'{"signals":[]}')).signals||[];
const edges=JSON.parse(await fs.readFile('config/edges.v2.json','utf8')).edges||[];
const mechCfg=JSON.parse(await fs.readFile('config/mechanisms.json','utf8'));

const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const round=n=>n==null?null:+n.toFixed(3);
function pearson(a,b){if(a.length<8||a.length!==b.length)return null;const ma=avg(a),mb=avg(b);let num=0,da=0,db=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;num+=x*y;da+=x*x;db+=y*y}return da&&db?num/Math.sqrt(da*db):null}
function alphaStats(id,h){const rows=ledger.filter(s=>s.mechanism_id===id&&s.horizons?.[h]);const returns=rows.map(s=>s.horizons[h].basket_return).filter(Number.isFinite),rel=rows.map(s=>s.horizons[h].relative_return).filter(Number.isFinite);return {samples:returns.length,hit_rate:returns.length?round(returns.filter(x=>x>0).length/returns.length):null,relative_hit_rate:rel.length?round(rel.filter(x=>x>0).length/rel.length):null,avg_return:round(avg(returns)),avg_relative_return:round(avg(rel))}}
function activations(id){const out=[];for(let i=0;i<series.length;i++){const c=series[i].mechanisms?.[id],p=series[i-1]?.mechanisms?.[id];if(c&&c.score>=45&&(!p||p.score<45))out.push(i)}return out}
function leadToConfirm(id){const acts=activations(id);let confirmed=0;const lags=[];for(const i of acts){let hit=null;for(let j=i;j<Math.min(series.length,i+5);j++){const x=series[j].mechanisms?.[id];if(x&&x.score>=65&&x.confirm>=1){hit=j-i;break}}if(hit!=null){confirmed++;lags.push(hit)}}return {samples:acts.length,confirmed,rate:acts.length?round(confirmed/acts.length):null,avg_lag_runs:round(avg(lags))}}
function marketLag(id){const acts=activations(id),lags=[];for(const i of acts){for(let j=i;j<Math.min(series.length,i+7);j++){const x=series[j].mechanisms?.[id];if(x&&x.market_score>=20){lags.push(j-i);break}}}return {samples:acts.length,observed:lags.length,avg_lag_runs:round(avg(lags)),median_lag_runs:lags.length?[...lags].sort((a,b)=>a-b)[Math.floor(lags.length/2)]:null}}

const mechanisms={};
for(const m of mechCfg.mechanisms){mechanisms[m.id]={alpha_1d:alphaStats(m.id,'d1'),alpha_5d:alphaStats(m.id,'d5'),alpha_20d:alphaStats(m.id,'d20'),lead_to_confirm:leadToConfirm(m.id),market_lag:marketLag(m.id)}}

const edgeStats=[];
for(const e of edges){
  const acts=activations(e.from);let hits=0;const hitLags=[];
  for(const i of acts){const base=series[i-1]?.mechanisms?.[e.to]?.score??series[i]?.mechanisms?.[e.to]?.score??0;let first=null;for(const lag of e.expected_lag_runs||[0,1,2]){const x=series[i+lag]?.mechanisms?.[e.to];if(!x)continue;const moved=x.score>=45||x.score-base>=10;if(moved){first=lag;break}}if(first!=null){hits++;hitLags.push(first)}}
  let best={lag:null,r:null,n:0};for(let lag=0;lag<=4;lag++){const a=[],b=[];for(let i=0;i+lag<series.length;i++){const x=series[i].mechanisms?.[e.from]?.score,y=series[i+lag].mechanisms?.[e.to]?.score;if(Number.isFinite(x)&&Number.isFinite(y)){a.push(x);b.push(y)}}const r=pearson(a,b);if(r!=null&&(best.r==null||Math.abs(r)>Math.abs(best.r)))best={lag,r:round(r),n:a.length}}
  edgeStats.push({...e,samples:acts.length,hits,propagation_rate:acts.length?round(hits/acts.length):null,avg_observed_lag_runs:round(avg(hitLags)),best_empirical_lag:best});
}

const out={version:'2.0.0',generated_at:new Date().toISOString(),runs:series.length,alpha_signals:ledger.length,mechanisms,edges:edgeStats};
await fs.writeFile('data/correlation-memory.json',JSON.stringify(out,null,2)+'\n');
console.log(`correlation memory: ${series.length} runs, ${ledger.length} alpha signals, ${edgeStats.length} causal edges`);
