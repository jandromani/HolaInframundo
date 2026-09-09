import fs from 'node:fs/promises';
import {collectAisHormuz,collectAcer,collectKalshi,collectEia,collectMofJgb,collectMofFlows,collectCftc,collectUsaspending,collectSam,collectUkmto,collectEntsoe,collectComtrade,clamp} from './pricing-adapters.mjs';

const cfg=JSON.parse(await fs.readFile('config/pricing-sensors.json','utf8'));
const now=new Date(),nowIso=now.toISOString();
const memoryPath='data/pricing-sensor-memory.json';
const memory=JSON.parse(await fs.readFile(memoryPath,'utf8').catch(()=>'{"version":"4.3.0","hormuz_density":[],"source_series":{}}'));
const observations={};
function put(source,data){observations[source]={source,family:cfg.sources[source]?.family||familyFallback(source),observed_at:nowIso,...data}}
function familyFallback(s){if(['AISSTREAM','EIA','UKMTO','ENTSOE','UN_COMTRADE'].includes(s))return'PHYSICAL';if(['USA_SPENDING','SAM_GOV'].includes(s))return'PROCUREMENT';if(['MOF_JGB','MOF_FLOWS','CFTC_COT','ACER_LNG'].includes(s))return'MARKET';if(s==='KALSHI')return'PREDICTION';return'UNKNOWN'}
function appendSeries(source,o){memory.source_series??={};memory.source_series[source]??=[];if(Number.isFinite(o?.pricing_score))memory.source_series[source].push({ts:nowIso,value:o.pricing_score,metric:o.metric||null});memory.source_series[source]=memory.source_series[source].slice(-180)}

const jobs={AISSTREAM:collectAisHormuz(cfg,memory),ACER_LNG:collectAcer(cfg),KALSHI:collectKalshi(cfg),EIA:collectEia(cfg),MOF_JGB:collectMofJgb(cfg),MOF_FLOWS:collectMofFlows(cfg),CFTC_COT:collectCftc(cfg),USA_SPENDING:collectUsaspending(cfg),SAM_GOV:collectSam(cfg),UKMTO:collectUkmto(cfg),ENTSOE:collectEntsoe(cfg),UN_COMTRADE:collectComtrade(cfg)};
for(const [source,p] of Object.entries(jobs))put(source,await p);
if(observations.AISSTREAM?.status==='OK'&&Number.isFinite(observations.AISSTREAM.unique_vessels)){memory.hormuz_density??=[];memory.hormuz_density.push({ts:nowIso,value:observations.AISSTREAM.unique_vessels});memory.hormuz_density=memory.hormuz_density.slice(-120)}
for(const [source,o] of Object.entries(observations))appendSeries(source,o);
memory.updated_at=nowIso;memory.version='4.3.0';

const sourceWeights={AISSTREAM:1.35,EIA:1.25,MOF_JGB:1.35,MOF_FLOWS:1.25,CFTC_COT:.85,USA_SPENDING:1.2,SAM_GOV:1.05,UKMTO:1.2,ENTSOE:1.15,UN_COMTRADE:.9,ACER_LNG:1.25,KALSHI:.75};
const mechanismSources={
 DIESEL_REFINING_CRISIS:['EIA','CFTC_COT'],PRODUCT_TANKER_TONMILES:['AISSTREAM','CFTC_COT'],CRUDE_TANKER_DISLOCATION:['AISSTREAM','CFTC_COT'],ATLANTIC_BARREL_PREMIUM:['AISSTREAM','EIA'],CEYHAN_BYPASS:['AISSTREAM','UKMTO'],LNG_REROUTING:['ACER_LNG','AISSTREAM','EIA','KALSHI'],
 ARSENAL_DEPLETION:['USA_SPENDING','SAM_GOV','KALSHI'],ROCKET_MOTOR_SHORTAGE:['USA_SPENDING','SAM_GOV'],ENERGETICS_SHORTAGE:['USA_SPENDING','SAM_GOV','UN_COMTRADE'],CHEAP_DRONE_SCALING:['USA_SPENDING','SAM_GOV','KALSHI'],COUNTER_UAS_COST_CURVE:['USA_SPENDING','SAM_GOV'],UNDERWATER_SECURITY:['UKMTO','AISSTREAM','USA_SPENDING','KALSHI'],MILITARY_ENERGY_AUTONOMY:['USA_SPENDING','SAM_GOV'],EUROPE_STRATEGIC_AUTONOMY:['USA_SPENDING','UN_COMTRADE'],
 AI_TIME_TO_POWER:['EIA','ENTSOE'],AI_GHOST_DEMAND:['ENTSOE'],BEHIND_METER_AI_POWER:['EIA','ENTSOE'],ROBOTICS_ACTUATOR_SCALE:['UN_COMTRADE'],ROBOTICS_DECOUPLING:['UN_COMTRADE'],STRATEGIC_ALUMINIUM:['UN_COMTRADE','CFTC_COT'],RARE_EARTH_MAGNET_SHORTAGE:['UN_COMTRADE'],NUCLEAR_FUEL_SOVEREIGNTY:['USA_SPENDING','EIA'],JAPAN_CARRY_UNWIND:['MOF_JGB','MOF_FLOWS','CFTC_COT','KALSHI'],GLOBAL_REFINANCING_STRESS:['CFTC_COT','KALSHI'],OT_CYBER_SHOCK:['USA_SPENDING','SAM_GOV','KALSHI'],OIL_SERVICE_CAPEX_SECOND_WAVE:['EIA','CFTC_COT']
};
function scoreFor(source,id){const o=observations[source];if(source==='KALSHI')return o?.mechanisms?.[id]?.pricing_score;return o?.pricing_score}
function rowFor(source,id){const o=observations[source],score=scoreFor(source,id);return {source,family:o?.family||cfg.sources[source]?.family||familyFallback(source),access:cfg.sources[source]?.access||null,status:o?.status||'UNOBSERVED',score:Number.isFinite(score)?score:null,metric:o?.metric||null,quality:o?.quality||null,weight:sourceWeights[source]||1}}
function aggregate(rows){const scored=rows.filter(x=>Number.isFinite(x.score));if(!scored.length)return {primary_priced_in:null,pricing_confidence:0,observed_sources:0};const sw=scored.reduce((a,x)=>a+x.weight,0),value=scored.reduce((a,x)=>a+x.score*x.weight,0)/sw;const possible=rows.filter(x=>x.status!=='PREMIUM').reduce((a,x)=>a+x.weight,0)||1;const coverage=sw/possible;const qualityBoost=scored.some(x=>x.quality==='PRIMARY_OFFICIAL'||x.quality==='PRIMARY_PHYSICAL')?10:0;return {primary_priced_in:Math.round(clamp(value)),pricing_confidence:Math.round(clamp(coverage*85+qualityBoost)),observed_sources:scored.length}}
const mechanisms={};
for(const id of Object.keys(cfg.mechanisms||{})){const requested=mechanismSources[id]||cfg.mechanisms[id]||[],rows=requested.map(source=>rowFor(source,id)),agg=aggregate(rows);mechanisms[id]={...agg,sources:rows,total_sources:rows.length,pricing_method:agg.observed_sources?'PRIMARY_MULTI_SENSOR':'NO_PRIMARY_OBSERVATION',blind_reasons:rows.filter(x=>!Number.isFinite(x.score)).map(x=>`${x.source}:${x.status}`)}}

const out={version:'4.3.0',generated_at:nowIso,observations,mechanisms,coverage:{mechanisms:Object.keys(mechanisms).length,live_sources:Object.values(observations).filter(x=>x.status==='OK').length,scored_sources:Object.keys(observations).filter(source=>source==='KALSHI'?Object.values(observations.KALSHI?.mechanisms||{}).some(x=>Number.isFinite(x.pricing_score)):Number.isFinite(observations[source]?.pricing_score)).length,configured_sources:Object.keys(cfg.sources).length,blocks:{ais_hormuz:observations.AISSTREAM?.status||'UNKNOWN',eia:observations.EIA?.status||'UNKNOWN',mof_japan:[observations.MOF_JGB?.status,observations.MOF_FLOWS?.status],us_procurement:[observations.USA_SPENDING?.status,observations.SAM_GOV?.status],cftc:observations.CFTC_COT?.status||'UNKNOWN',ukmto:observations.UKMTO?.status||'UNKNOWN',entsoe:observations.ENTSOE?.status||'UNKNOWN',comtrade:observations.UN_COMTRADE?.status||'UNKNOWN'},retained:{acer_lng:observations.ACER_LNG?.status||'UNKNOWN',kalshi:observations.KALSHI?.status||'UNKNOWN'}}};
await fs.writeFile('data/pricing-sensors.json',JSON.stringify(out,null,2)+'\n');await fs.writeFile(memoryPath,JSON.stringify(memory,null,2)+'\n');
console.log(`pricing sensors v4.3: live=${out.coverage.live_sources} scored=${out.coverage.scored_sources} blocks=8 mechanisms=${out.coverage.mechanisms}`);
