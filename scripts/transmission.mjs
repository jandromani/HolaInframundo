import fs from 'node:fs/promises';
import {scoreTransmission} from './transmission-core.mjs';

const seeds=JSON.parse(await fs.readFile('config/investment-seeds.json','utf8'));
const models=JSON.parse(await fs.readFile('config/transmission-models.json','utf8'));
const fundamentals=JSON.parse(await fs.readFile('data/fundamentals.json','utf8').catch(()=>'{"companies":{}}'));
const market=JSON.parse(await fs.readFile('data/market.json','utf8').catch(()=>'{"metrics":{}}'));
const current=JSON.parse(await fs.readFile('data/current.json','utf8').catch(()=>'{"mechanisms":{}}'));
const broker=JSON.parse(await fs.readFile('data/broker.json','utf8').catch(()=>'{"instruments":{}}'));
const now=new Date().toISOString();
const out={version:'2.8.1',generated_at:now,run_id:current.run_id||market.run_id||null,method:'Company Transmission 2-pass: structural transmission first, financial calibration second; market excluded from Transmission Score',mechanisms:{},stats:{mechanisms:0,candidate_rows:0,high_convexity:0,strong:0,moderate:0,weak:0,live_fundamentals:0,partial_fundamentals:0,structural_only:0,avg_structural_score:0,avg_financial_score:0,avg_score:0,avg_delta:0,avg_financial_coverage:0,avg_confidence:0}};
const all=[];
for(const [id,rows] of Object.entries(seeds.mechanisms||{})){
  const model=models.mechanisms?.[id];if(!model)throw new Error(`Missing transmission model for ${id}`);
  const candidates=(rows||[]).map(([symbol,fit,exposure])=>{
    const f=fundamentals.companies?.[symbol]||{symbol,quality:'STRUCTURAL_ONLY',coverage:0},price=market.metrics?.[symbol]?.price??f.price??null,transmission=scoreTransmission({fit,exposure,model,fundamental:f,price}),br=broker.instruments?.[symbol]||{};
    return {symbol,fit,exposure,price,broker_available:br.available??null,broker_verified:Boolean(br.verified),fundamental:{quality:f.quality||'STRUCTURAL_ONLY',coverage:f.coverage??0,period_end:f.period_end||null,market_cap:f.market_cap??transmission.financials?.market_cap??null,name:f.name||null},transmission};
  }).sort((a,b)=>b.transmission.risk_adjusted_score-a.transmission.risk_adjusted_score||b.transmission.score-a.transmission.score||b.fit-a.fit);
  const avg=k=>candidates.length?candidates.reduce((a,x)=>a+Number(k(x)||0),0)/candidates.length:0;
  out.mechanisms[id]={id,state:current.mechanisms?.[id]?.state||'UNKNOWN',model:{mode:model.mode,shock:model.shock,earnings_channel:model.earnings_channel,bridge:model.bridge,diluters:model.diluters},candidates,summary:{avg_structural:+avg(x=>x.transmission?.passes?.structural?.score).toFixed(1),avg_financial:+avg(x=>x.transmission?.passes?.financial?.score).toFixed(1),avg_score:+avg(x=>x.transmission.score).toFixed(1),avg_delta:+avg(x=>x.transmission?.passes?.final?.delta).toFixed(1),avg_confidence:+avg(x=>x.transmission.confidence).toFixed(1),best:candidates[0]?.symbol||null,best_score:candidates[0]?.transmission.score||null}};all.push(...candidates);
}
out.stats.mechanisms=Object.keys(out.mechanisms).length;out.stats.candidate_rows=all.length;
for(const x of all){const l=x.transmission.label;if(l==='HIGH_CONVEXITY')out.stats.high_convexity++;else if(l==='STRONG')out.stats.strong++;else if(l==='MODERATE')out.stats.moderate++;else out.stats.weak++;const q=x.fundamental.quality;if(q==='LIVE_YAHOO')out.stats.live_fundamentals++;else if(q==='PARTIAL_YAHOO')out.stats.partial_fundamentals++;else out.stats.structural_only++}
const avgAll=fn=>all.length?all.reduce((a,x)=>a+Number(fn(x)||0),0)/all.length:0;
out.stats.avg_structural_score=+avgAll(x=>x.transmission?.passes?.structural?.score).toFixed(1);out.stats.avg_financial_score=+avgAll(x=>x.transmission?.passes?.financial?.score).toFixed(1);out.stats.avg_score=+avgAll(x=>x.transmission.score).toFixed(1);out.stats.avg_delta=+avgAll(x=>x.transmission?.passes?.final?.delta).toFixed(1);out.stats.avg_financial_coverage=+avgAll(x=>x.transmission?.passes?.financial?.coverage).toFixed(3);out.stats.avg_confidence=+avgAll(x=>x.transmission.confidence).toFixed(1);
await fs.writeFile('data/transmission-layer.json',JSON.stringify(out,null,2)+'\n');
console.log(`transmission 2-pass: mechanisms=${out.stats.mechanisms} candidates=${out.stats.candidate_rows} P1=${out.stats.avg_structural_score} P2=${out.stats.avg_financial_score} final=${out.stats.avg_score} delta=${out.stats.avg_delta} fincov=${Math.round(out.stats.avg_financial_coverage*100)}% conf=${out.stats.avg_confidence}`);
