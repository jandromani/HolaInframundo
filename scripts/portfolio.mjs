import fs from 'node:fs/promises';
import {
  marketRegime,strategyUniverse,candidateForStrategy,sizeOrder,evaluateExit,
  riskGroupFor,isProtectedSymbol,canOpenNewPosition,normalizeSymbol
} from '../lib/execution-core.mjs';

const policy=JSON.parse(await fs.readFile('config/execution-policy.json','utf8'));
const inv=JSON.parse(await fs.readFile('data/investment-layer.json','utf8').catch(()=>'{"strategies":{}}'));
const market=JSON.parse(await fs.readFile('data/market.json','utf8').catch(()=>'{"metrics":{},"context":{}}'));
const portfolio=JSON.parse(await fs.readFile('data/paper-portfolio.json','utf8'));
const now=new Date();

const regime=marketRegime(market.context||{},policy);
const positions=(portfolio.positions||[]).filter(p=>!isProtectedSymbol(p.symbol,policy)).map(p=>{
  const px=Number(market.metrics?.[p.symbol]?.price);
  const currentPrice=Number.isFinite(px)?px:Number(p.current_price||p.entry_price);
  const maxPrice=Math.max(Number(p.max_price||p.entry_price),currentPrice);
  const mv=Number(p.quantity||0)*currentPrice;
  return {...p,current_price:currentPrice,max_price:maxPrice,market_value_usd:+mv.toFixed(2),unrealized_pnl_usd:+(mv-Number(p.cost_usd||0)).toFixed(2)};
});
const cash=Number(portfolio.cash_usd||0);
const plan={
  version:'3.0.0',mode:'SHADOW_ONLY',generated_at:now.toISOString(),run_id:inv.run_id||market.run_id||null,
  policy_version:policy.version,regime,capital:{budget_usd:Number(policy.capital.initial_budget_usd),cash_usd:cash,max_order_usd:Number(policy.capital.max_order_usd),max_positions:Number(policy.capital.max_open_positions)},
  protected_symbols:policy.protected_symbols||[],top_quantile:Number(policy.selection.top_quantile||.2),
  exits:[],entries:[],topups:[],blocked:[],eligible_strategies:[],summary:{}
};

for(const p of positions){
  const s=inv.strategies?.[p.mechanism_id]||null;
  const x=evaluateExit({position:p,strategy:s,currentPrice:p.current_price,now,policy});
  if(x.exit) plan.exits.push({type:'EXIT',symbol:p.symbol,mechanism_id:p.mechanism_id,quantity:Number(p.quantity),reference_price:p.current_price,reason:x.reason,pnl_pct:+Number(x.pnl_pct||0).toFixed(2),risk_group:p.risk_group});
}

const exitingSymbols=new Set(plan.exits.map(x=>normalizeSymbol(x.symbol)));
const projectedPositions=positions.filter(p=>!exitingSymbols.has(normalizeSymbol(p.symbol)));
let projectedCash=cash;
for(const x of plan.exits){const p=positions.find(p=>normalizeSymbol(p.symbol)===normalizeSymbol(x.symbol));projectedCash+=Number(p?.quantity||0)*Number(x.reference_price||0)}

const eligible=strategyUniverse(inv.strategies||{},regime,policy);
plan.eligible_strategies=eligible.map(s=>({id:s.id,label:s.label,action:s.action,opportunity_score:s.opportunity_score,wave_phase:s.wave_phase,priced_in:s.priced_in,transmission_score:s.transmission_score}));

for(const s of eligible){
  if(!canOpenNewPosition(projectedPositions,policy)) break;
  const c=candidateForStrategy(s,projectedPositions,policy);
  if(!c){plan.blocked.push({mechanism_id:s.id,reason:'NO_UNHELD_INVESTABLE_CANDIDATE'});continue}
  const sized=sizeOrder({strategy:s,candidate:c,positions:projectedPositions,cashUsd:projectedCash,regime,policy});
  if(!sized.usd){plan.blocked.push({mechanism_id:s.id,symbol:c.symbol,reason:sized.reason});continue}
  const quantity=sized.usd/Number(c.market.price);
  const entry={
    type:'ENTRY',symbol:c.symbol,mechanism_id:s.id,risk_group:sized.group,action:s.action,
    opportunity_score:s.opportunity_score,wave_phase:s.wave_phase,priced_in:s.priced_in,
    transmission_score:Number(c.transmission?.score||0),market_score:Number(c.market?.score||0),
    reference_price:Number(c.market.price),usd:sized.usd,quantity:+quantity.toFixed(6),reason:'TOP_QUINTILE_CAUSAL_TRANSMISSION_TIMING',
    broker_available:c.broker_available===true,protected:false
  };
  plan.entries.push(entry);
  projectedCash-=sized.usd;
  projectedPositions.push({symbol:c.symbol,mechanism_id:s.id,risk_group:sized.group,cost_usd:sized.usd,market_value_usd:sized.usd});
}

// If all six slots are occupied and a small residual remains, only allow it to reinforce an existing
// position that has upgraded to DEPLOY_WINDOW. Never create a seventh position and never average down.
const cap=policy.capital||{};
if(projectedPositions.length>=Number(cap.max_open_positions||6)&&projectedCash>0&&projectedCash<=Number(cap.residual_topup_max_usd||20)){
  const ranked=[...projectedPositions].map(p=>({p,s:inv.strategies?.[p.mechanism_id]})).filter(x=>x.s?.action==='DEPLOY_WINDOW'&&!isProtectedSymbol(x.p.symbol,policy)).sort((a,b)=>Number(b.s?.opportunity_score||0)-Number(a.s?.opportunity_score||0));
  const best=ranked[0];
  if(best){
    const live=positions.find(p=>normalizeSymbol(p.symbol)===normalizeSymbol(best.p.symbol));
    const px=Number(market.metrics?.[best.p.symbol]?.price);
    const entry=Number(live?.entry_price||px);
    const currentExposure=Number(best.p.market_value_usd||best.p.cost_usd||0);
    const room=Math.max(0,Number(cap.max_symbol_exposure_usd||100)-currentExposure);
    const usd=Math.min(projectedCash,Number(cap.residual_topup_max_usd||20),Number(cap.max_order_usd||80),room);
    if(usd>=5&&Number.isFinite(px)&&(!policy.rotation?.never_average_down||px>=entry)){
      plan.topups.push({type:'TOPUP',symbol:best.p.symbol,mechanism_id:best.p.mechanism_id,risk_group:best.p.risk_group,usd:+usd.toFixed(2),quantity:+(usd/px).toFixed(6),reference_price:px,reason:'RESIDUAL_DEPLOY_TOPUP'});
      projectedCash-=usd;
    }
  }
}

plan.summary={regime:regime.regime,regime_score:regime.score,positions_before:positions.length,planned_exits:plan.exits.length,planned_entries:plan.entries.length,planned_topups:plan.topups.length,eligible_strategies:eligible.length,projected_cash_usd:+projectedCash.toFixed(2),projected_positions:projectedPositions.length,protected_symbols:(policy.protected_symbols||[]).length,live_execution:false};
await fs.writeFile('data/execution-plan.json',JSON.stringify(plan,null,2)+'\n');
console.log(`portfolio v3 shadow: regime=${regime.regime} score=${regime.score} eligible=${eligible.length} exits=${plan.exits.length} entries=${plan.entries.length} topups=${plan.topups.length} cash->${plan.summary.projected_cash_usd}`);
