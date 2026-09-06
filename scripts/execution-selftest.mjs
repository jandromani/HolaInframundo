import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {isProtectedSymbol,marketRegime,strategyUniverse,sizeOrder,evaluateExit,canOpenNewPosition,riskGroupFor,candidateMomentumEligible,candidateForStrategy,usRegularMarketSession} from '../lib/execution-core.mjs';

const policy=JSON.parse(await fs.readFile('config/execution-policy.json','utf8'));
assert.equal(policy.mode,'SHADOW_ONLY');assert.equal(policy.capital.initial_budget_usd,500);assert.equal(policy.capital.max_order_usd,80);assert.equal(policy.capital.max_open_positions,6);
assert.equal(isProtectedSymbol('SGMOQ',policy),true);assert.equal(isProtectedSymbol('SGMOQ_US_EQ',policy),true);assert.equal(isProtectedSymbol('sgmoq.us',policy),true);assert.equal(isProtectedSymbol('SGMO',policy),false);

const now=new Date('2026-09-08T15:00:00Z'); // Tuesday 11:00 New York (EDT), regular session.
const freshIso=new Date(now.getTime()-15*60000).toISOString();
const bullish={asof:freshIso,above20:true,above50:true,above200:true,intraday:{asof:freshIso,ret2h:1}},context={'^GSPC':bullish,'^IXIC':bullish,QQQ:bullish,IWM:bullish};
const risk=marketRegime(context,policy,now);assert.equal(risk.regime,'RISK_ON');assert.equal(risk.entry_allowed,true);assert.equal(risk.freshness.fresh,true);assert.equal(risk.session.regular_open,true);assert.ok(risk.score>=65);
const bad={asof:freshIso,above20:false,above50:false,above200:false,intraday:{asof:freshIso,ret2h:-1}},off=marketRegime({'^GSPC':bad,'^IXIC':bad,QQQ:bad,IWM:bad},policy,now);assert.equal(off.regime,'RISK_OFF');assert.equal(off.entry_allowed,false);
const staleIso=new Date(now.getTime()-8*3600000).toISOString(),staleBull={...bullish,asof:staleIso,intraday:{asof:staleIso,ret2h:1}},stale=marketRegime({'^GSPC':staleBull,'^IXIC':staleBull,QQQ:staleBull,IWM:staleBull},policy,now);assert.equal(stale.regime,'RISK_ON');assert.equal(stale.entry_allowed,false);assert.equal(stale.block_reason,'STALE_MARKET_DATA');assert.equal(stale.freshness.fresh,false);
const sunday=new Date('2026-09-06T14:00:00Z'),closed=marketRegime(context,policy,sunday);assert.equal(usRegularMarketSession(sunday).label,'CLOSED_WEEKEND');assert.equal(closed.entry_allowed,false);assert.equal(closed.block_reason,'MARKET_CLOSED');

const strategies=Object.fromEntries(Array.from({length:10},(_,i)=>[`M${i}`,{id:`M${i}`,action:i<5?'SCOUT_WINDOW':'RESEARCH_ONLY',opportunity_score:100-i,wave_phase:'EARLY_WAVE',crowd:{block_chase:false},top5:[]} ]));
const top=strategyUniverse(strategies,risk,policy);assert.equal(top.length,2,'top 20% of ten strategies should be two');assert.deepEqual(top.map(x=>x.id),['M0','M1']);

const candidate={symbol:'ABC',broker_available:true,market:{price:20,score:70,rel5:2,rel2h:.5,above20:true},transmission:{confidence:90}},scout={id:'AI_TIME_TO_POWER',action:'SCOUT_WINDOW',priced_in:20};
assert.equal(candidateMomentumEligible(scout,candidate,policy).ok,true);assert.equal(candidateMomentumEligible({...scout,action:'DEPLOY_WINDOW'},candidate,policy).ok,true);
const laggard={...candidate,symbol:'LAG',market:{...candidate.market,score:75,rel5:-2,rel2h:-.5,above20:false}};assert.equal(candidateMomentumEligible(scout,laggard,policy).ok,false);assert.equal(candidateMomentumEligible({...scout,action:'DEPLOY_WINDOW'},laggard,policy).ok,false);
const scoutSize=sizeOrder({strategy:scout,candidate,positions:[],cashUsd:500,regime:risk,policy});assert.equal(scoutSize.usd,40);assert.equal(scoutSize.group,'AI_POWER');
const deploySize=sizeOrder({strategy:{...scout,action:'DEPLOY_WINDOW'},candidate,positions:[],cashUsd:500,regime:risk,policy});assert.equal(deploySize.usd,80);
const staleSize=sizeOrder({strategy:scout,candidate,positions:[],cashUsd:500,regime:stale,policy});assert.equal(staleSize.usd,0);assert.equal(staleSize.reason,'STALE_MARKET_DATA');
const closedSize=sizeOrder({strategy:scout,candidate,positions:[],cashUsd:500,regime:closed,policy});assert.equal(closedSize.usd,0);assert.equal(closedSize.reason,'MARKET_CLOSED');
const weakSize=sizeOrder({strategy:scout,candidate:laggard,positions:[],cashUsd:500,regime:risk,policy});assert.equal(weakSize.usd,0);
const protectedSize=sizeOrder({strategy:scout,candidate:{...candidate,symbol:'SGMOQ'},positions:[],cashUsd:500,regime:risk,policy});assert.equal(protectedSize.usd,0);assert.equal(protectedSize.reason,'PROTECTED_SYMBOL');
const groupLimited=sizeOrder({strategy:scout,candidate,positions:[{symbol:'X',risk_group:'AI_POWER',market_value_usd:155}],cashUsd:500,regime:risk,policy});assert.equal(groupLimited.usd,0);
const expanded={...scout,ranked_candidates:[laggard,candidate],top5:[laggard]};assert.equal(candidateForStrategy(expanded,[],policy).symbol,'ABC','Execution may use the broader ranked pool when the first candidate fails momentum');

const p={symbol:'ABC',entry_price:100,max_price:110,current_price:91,quantity:1,cost_usd:100,opened_at:new Date(Date.now()-2*86400000).toISOString(),mechanism_id:'AI_TIME_TO_POWER'};
const stop=evaluateExit({position:p,strategy:{action:'DEPLOY_WINDOW',wave_phase:'EARLY_WAVE'},currentPrice:91,policy});assert.equal(stop.exit,true);assert.equal(stop.reason,'STOP_LOSS');
const locked=evaluateExit({position:{...p,symbol:'SGMOQ'},strategy:{action:'INVALIDATED',wave_phase:'SATURATED'},currentPrice:1,policy});assert.equal(locked.exit,false);assert.equal(locked.reason,'PROTECTED_SYMBOL');
assert.equal(canOpenNewPosition(Array.from({length:5},(_,i)=>({symbol:`X${i}`})),policy),true);assert.equal(canOpenNewPosition(Array.from({length:6},(_,i)=>({symbol:`X${i}`})),policy),false);assert.equal(riskGroupFor('ROCKET_MOTOR_SHORTAGE',policy),'DEFENSE_INDUSTRIAL');
console.log('GearWatch V3.1 execution selftest OK: $500 sleeve + $80 cap + top quintile + market-session/freshness gates + ranked pool + SGMOQ isolation');
