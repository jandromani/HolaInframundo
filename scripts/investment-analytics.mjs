import fs from 'node:fs/promises';
import {companyEntryAnalytics,finite} from './investment-analytics-core.mjs';

const path='data/investment-layer.json';
const layer=JSON.parse(await fs.readFile(path,'utf8').catch(()=>'{"strategies":{}}'));
const market=JSON.parse(await fs.readFile('data/market.json','utf8').catch(()=>'{"metrics":{}}'));
const fundamentals=JSON.parse(await fs.readFile('data/fundamentals.json','utf8').catch(()=>'{"companies":{}}'));
const current=JSON.parse(await fs.readFile('data/current.json','utf8').catch(()=>'{"mechanisms":{}}'));
if(!layer.strategies||!Object.keys(layer.strategies).length)throw new Error('Investment layer is empty before analytics enrichment');

const all=[],blindCounts={};
for(const [id,s] of Object.entries(layer.strategies)){
  const mechanism=current.mechanisms?.[id]||{},causal=Number(s.causal_score??mechanism.score??0),pricedIn=Number(s.priced_in??mechanism.crowd?.priced_in??0),wave=s.wave_phase||mechanism.crowd?.phase||'DISCOVERY';
  const rows=(s.top_candidates||s.top5||[]).map(row=>{
    const mm=market.metrics?.[row.symbol]||{},fund=fundamentals.companies?.[row.symbol]||row.fundamental||{},analytics=companyEntryAnalytics({causal,pricedIn,wave,transmission:Number(row.transmission?.risk_adjusted_score??row.transmission?.score??s.transmission_score??50),financialPass:Number(row.transmission?.passes?.financial?.score??s.financial_score??50),market:mm,fundamental:fund});
    for(const sensor of analytics.blind_sensors)blindCounts[sensor]=(blindCounts[sensor]||0)+1;
    const enriched={...row,entry:{...analytics,price_history:{asof:mm.asof||null,price:mm.price??null,ret7:mm.ret7??null,ret30:mm.ret30??null,ret90:mm.ret90??null,ret180:mm.ret180??null,high52:mm.high52??null,low52:mm.low52??null,drawdown52:mm.drawdown52??null},technical:{sma20:mm.sma20??null,sma50:mm.sma50??null,sma200:mm.sma200??null,above20:mm.above20??null,above50:mm.above50??null,above200:mm.above200??null},data_quality:{market:mm.asof?'LIVE':'MISSING',fundamental:fund.quality||'UNKNOWN'}}};
    all.push({mechanism_id:id,label:s.label,symbol:row.symbol,...enriched.entry});return enriched;
  });
  const sorted=[...rows].sort((a,b)=>Number(b.entry?.entry_quality_score||0)-Number(a.entry?.entry_quality_score||0)||Number(b.rank_score||0)-Number(a.rank_score||0));
  s.entry_candidates=sorted;
  s.entry_best=sorted[0]?{symbol:sorted[0].symbol,score:sorted[0].entry.entry_quality_score,verdict:sorted[0].entry.verdict}:null;
  s.entry_summary={candidates:sorted.length,attractive:sorted.filter(x=>x.entry?.verdict==='ATTRACTIVE_SETUP').length,selective:sorted.filter(x=>x.entry?.verdict==='SELECTIVE_SETUP').length,do_not_chase:sorted.filter(x=>x.entry?.verdict==='DO_NOT_CHASE').length,high_risk:sorted.filter(x=>x.entry?.verdict==='HIGH_RISK').length,avg_coverage:sorted.length?Math.round(sorted.reduce((a,x)=>a+Number(x.entry?.coverage_score||0),0)/sorted.length):0};
}
all.sort((a,b)=>Number(b.entry_quality_score||0)-Number(a.entry_quality_score||0));
layer.version='4.0.0';layer.analytics={version:'1.0.0',generated_at:new Date().toISOString(),method:'causal edge × financial quality × market setup × company transmission; deterministic no-chase and falling-knife penalties',disclaimer:'Research prioritization only. No automatic buy/sell orders.',blind_sensor_counts:blindCounts,coverage_note:'Earnings revisions, insider flows and institutional flows are intentionally marked blind until a reliable collector is added.'};
layer.entry_leaderboard=all.slice(0,40).map(x=>({mechanism_id:x.mechanism_id,label:x.label,symbol:x.symbol,score:x.entry_quality_score,verdict:x.verdict,causal_edge_score:x.causal_edge_score,financial_quality_score:x.financial_quality_score,market_setup_score:x.market_setup_score,coverage_score:x.coverage_score,price_history:x.price_history,fundamentals:x.fundamentals,blind_sensors:x.blind_sensors}));
layer.summary={...(layer.summary||{}),entry_candidates:all.length,attractive_setups:all.filter(x=>x.verdict==='ATTRACTIVE_SETUP').length,selective_setups:all.filter(x=>x.verdict==='SELECTIVE_SETUP').length,do_not_chase_setups:all.filter(x=>x.verdict==='DO_NOT_CHASE').length,high_risk_setups:all.filter(x=>x.verdict==='HIGH_RISK').length,analytics_coverage:all.length?Math.round(all.reduce((a,x)=>a+Number(x.coverage_score||0),0)/all.length):0,market_history_7_30_90_180:all.filter(x=>[x.price_history?.ret7,x.price_history?.ret30,x.price_history?.ret90,x.price_history?.ret180].every(finite)).length};
await fs.writeFile(path,JSON.stringify(layer,null,2)+'\n');
console.log(`investment analytics v1.0: candidates=${all.length} attractive=${layer.summary.attractive_setups} selective=${layer.summary.selective_setups} chase=${layer.summary.do_not_chase_setups} coverage=${layer.summary.analytics_coverage}%`);
