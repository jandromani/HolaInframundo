import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {isProtectedSymbol,marketRegime,strategyUniverse,sizeOrder,evaluateExit,canOpenNewPosition,riskGroupFor} from '../lib/execution-core.mjs';

const policy=JSON.parse(await fs.readFile('config/execution-policy.json','utf8'));
assert.equal(policy.mode,'SHADOW_ONLY');assert.equal(policy.capital.initial_budget_usd,500);assert.equal(policy.capital.max_order_usd,80);assert.equal(policy.capital.max_open_positions,6);
assert.equal(isProtectedSymbol('SGMOQ',policy),true);assert.equal(isProtectedSymbol('SGMOQ_US_EQ',policy),true);assert.equal(isProtectedSymbol('sgmoq.us',policy),true);assert.equal(isProtectedSymbol('SGMO',policy),false);

const bullish={above20:true,above50:true,above200:true,intraday:{ret2h:1}},context={'^GSPC':bullish,'^IXIC':bullish,QQQ:bullish,IWM:bullish};
const risk=marketRegime(context,policy);assert.equal(risk.regime,'RISK_ON');assert.equal(risk.entry_allowed,true);assert.ok(risk.score>=65);
const bad={above20:false,above50:false,above200:false,intraday:{ret2h:-1}},off=marketRegime({'^GSPC':bad,'^IXIC':bad,QQQ:bad,IWM:bad},policy);assert.equal(off.regime,'RISK_OFF');assert.equal(off.entry_allowed,false);

const strategies=Object.fromEntries(Array.from({length:10},(_,i)=>[`M${i}`,{id:`M${i}`,action:i<5?'SCOUT_WINDOW':'RESEARCH_ONLY',opportunity_score:100-i,wave_phase:'EARLY_WAVE',crowd:{block_chase:false},top5:[]} ]));
const top=strategyUniverse(strategies,risk,policy);assert.equal(top.length,2,'top 20% of ten strategies should be two');assert.deepEqual(top.map(x=>x.id),['M0','M1']);

const candidate={symbol:'ABC',broker_available:true,market:{price:20,score:70},transmission:{confidence:90}},scout={id:'AI_TIME_TO_POWER',action:'SCOUT_WINDOW',priced_in:20};
const scoutSize=sizeOrder({strategy:scout,candidate,positions:[],cashUsd:500,regime:risk,policy});assert.equal(scoutSize.usd,40);assert.equal(scoutSize.group,'AI_POWER');
const deploySize=sizeOrder({strategy:{...scout,action:'DEPLOY_WINDOW'},candidate,positions:[],cashUsd:500,regime:risk,policy});assert.equal(deploySize.usd,80);
const protectedSize=sizeOrder({strategy:scout,candidate:{...candidate,symbol:'SGMOQ'},positions:[],cashUsd:500,regime:risk,policy});assert.equal(protectedSize.usd,0);assert.equal(protectedSize.reason,'PROTECTED_SYMBOL');
const groupLimited=sizeOrder({strategy:scout,candidate,positions:[{symbol:'X',risk_group:'AI_POWER',market_value_usd:155}],cashUsd:500,regime:risk,policy});assert.equal(groupLimited.usd,0,'less than $10 risk-group room should block a new order');

const p={symbol:'ABC',entry_price:100,max_price:110,current_price:91,quantity:1,cost_usd:100,opened_at:new Date(Date.now()-2*86400000).toISOString(),mechanism_id:'AI_TIME_TO_POWER'};
const stop=evaluateExit({position:p,strategy:{action:'DEPLOY_WINDOW',wave_phase:'EARLY_WAVE'},currentPrice:91,policy});assert.equal(stop.exit,true);assert.equal(stop.reason,'STOP_LOSS');
const locked=evaluateExit({position:{...p,symbol:'SGMOQ'},strategy:{action:'INVALIDATED',wave_phase:'SATURATED'},currentPrice:1,policy});assert.equal(locked.exit,false);assert.equal(locked.reason,'PROTECTED_SYMBOL');
assert.equal(canOpenNewPosition(Array.from({length:5},(_,i)=>({symbol:`X${i}`})),policy),true);assert.equal(canOpenNewPosition(Array.from({length:6},(_,i)=>({symbol:`X${i}`})),policy),false);
assert.equal(riskGroupFor('ROCKET_MOTOR_SHORTAGE',policy),'DEFENSE_INDUSTRIAL');

console.log('GearWatch V3 execution selftest OK: $500 sleeve + $80 cap + top quintile + regime gate + SGMOQ hard isolation');
