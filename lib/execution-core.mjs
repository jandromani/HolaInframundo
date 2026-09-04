const DAY_MS=86400000;
export const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,Number(x)||0));

export function normalizeSymbol(value){
  return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
}
export function isProtectedSymbol(symbol,policy){
  const n=normalizeSymbol(symbol);
  return (policy?.protected_symbols||[]).some(x=>{
    const p=normalizeSymbol(x);
    return n===p || n.startsWith(p);
  });
}
export function riskGroupFor(mechanismId,policy){
  for(const [group,ids] of Object.entries(policy?.risk_groups||{})) if((ids||[]).includes(mechanismId)) return group;
  return 'OTHER';
}

function metric(context,ticker){return context?.[ticker]||null}
function bool(v){return v===true?1:0}
export function marketRegime(context={},policy={}){
  const spx=metric(context,'^GSPC'),nas=metric(context,'^IXIC'),qqq=metric(context,'QQQ'),iwm=metric(context,'IWM');
  let score=0;
  // Broad trend carries most of the vote; intraday only confirms, never dominates.
  for(const x of [spx,nas]){score+=bool(x?.above20)*10+bool(x?.above50)*10+bool(x?.above200)*5}
  for(const x of [qqq,iwm]){score+=bool(x?.above20)*10+bool(x?.above50)*10}
  score+=(Number(spx?.intraday?.ret2h)>0?5:0)+(Number(qqq?.intraday?.ret2h)>0?5:0);
  score=Math.round(clamp(score,0,100));
  const p=policy?.market_regime||{},riskOn=Number(p.risk_on_min??65),selective=Number(p.selective_min??45);
  const regime=score>=riskOn?'RISK_ON':score>=selective?'SELECTIVE':'RISK_OFF';
  return {regime,score,entry_allowed:(p.entry_allowed||['RISK_ON','SELECTIVE']).includes(regime),signals:{spx,nasdaq:nas,qqq,iwm}};
}

export function strategyUniverse(strategies={},regime,policy={}){
  const all=Object.values(strategies||{}).filter(Boolean);
  const q=Math.max(.01,Math.min(1,Number(policy?.selection?.top_quantile??.2)));
  const take=Math.max(1,Math.ceil(all.length*q));
  const sorted=[...all].sort((a,b)=>Number(b.opportunity_score||0)-Number(a.opportunity_score||0));
  const topIds=new Set(sorted.slice(0,take).map(x=>x.id));
  const threshold=regime?.regime==='RISK_ON'?Number(policy?.selection?.min_opportunity_risk_on??55):Number(policy?.selection?.min_opportunity_selective??62);
  const allowedActions=new Set(policy?.selection?.allowed_actions||['SCOUT_WINDOW','DEPLOY_WINDOW']);
  return sorted.filter(s=>topIds.has(s.id)&&allowedActions.has(s.action)&&Number(s.opportunity_score||0)>=threshold&&!s.crowd?.block_chase&&!['LATE_WAVE','SATURATED'].includes(s.wave_phase));
}

function usdExposure(positions,symbol){
  return positions.filter(p=>normalizeSymbol(p.symbol)===normalizeSymbol(symbol)).reduce((a,p)=>a+Number(p.market_value_usd??p.cost_usd??0),0);
}
function groupExposure(positions,group){
  return positions.filter(p=>p.risk_group===group).reduce((a,p)=>a+Number(p.market_value_usd??p.cost_usd??0),0);
}
export function sizeOrder({strategy,candidate,positions=[],cashUsd,regime,policy}){
  const cap=policy?.capital||{},exec=policy?.execution||{};
  if(!strategy||!candidate||!Number.isFinite(Number(candidate.market?.price))) return {usd:0,reason:'NO_PRICE'};
  if(isProtectedSymbol(candidate.symbol,policy)) return {usd:0,reason:'PROTECTED_SYMBOL'};
  if(!regime?.entry_allowed) return {usd:0,reason:'MARKET_REGIME_BLOCK'};
  const group=riskGroupFor(strategy.id,policy),symbolExposure=usdExposure(positions,candidate.symbol),grpExposure=groupExposure(positions,group);
  let target=strategy.action==='DEPLOY_WINDOW'?Number(cap.deploy_order_usd??80):Number(cap.scout_order_usd??40);
  if(regime.regime==='SELECTIVE') target*=Number(policy?.market_regime?.selective_size_multiplier??.75);
  if(Number(strategy.priced_in||0)>50) target*=.75;
  if(Number(candidate.transmission?.confidence||0)<80) target*=.75;
  const roomSymbol=Math.max(0,Number(cap.max_symbol_exposure_usd??100)-symbolExposure);
  const roomGroup=Math.max(0,Number(cap.max_risk_group_exposure_usd??160)-grpExposure);
  const hardMax=Number(cap.max_order_usd??80);
  const usd=Math.max(0,Math.min(target,hardMax,roomSymbol,roomGroup,Number(cashUsd||0)));
  if(usd<10) return {usd:0,reason:'INSUFFICIENT_RISK_BUDGET',group};
  return {usd:+usd.toFixed(2),reason:'OK',group,reference_price:Number(candidate.market.price),chase_limit_pct:Number(exec.price_chase_limit_pct??2.5)};
}

export function evaluateExit({position,strategy,currentPrice,now=new Date(),policy}){
  if(!position) return {exit:false,reason:'NO_POSITION'};
  if(isProtectedSymbol(position.symbol,policy)) return {exit:false,reason:'PROTECTED_SYMBOL'};
  const price=Number(currentPrice),entry=Number(position.entry_price),maxPrice=Math.max(Number(position.max_price||entry),Number.isFinite(price)?price:entry);
  if(!Number.isFinite(price)||!Number.isFinite(entry)||entry<=0) return {exit:false,reason:'NO_PRICE'};
  const pnlPct=((price/entry)-1)*100,drawdownPct=((price/maxPrice)-1)*100;
  const rot=policy?.rotation||{},heldDays=(now.getTime()-new Date(position.opened_at).getTime())/DAY_MS;
  if((rot.exit_on_actions||[]).includes(strategy?.action)) return {exit:true,reason:`ACTION_${strategy.action}`,pnl_pct:pnlPct};
  if((rot.exit_on_wave||[]).includes(strategy?.wave_phase)) return {exit:true,reason:`WAVE_${strategy.wave_phase}`,pnl_pct:pnlPct};
  if(pnlPct<=Number(rot.stop_loss_pct??-8)) return {exit:true,reason:'STOP_LOSS',pnl_pct:pnlPct};
  if(pnlPct>=Number(rot.take_profit_pct??15)) return {exit:true,reason:'TAKE_PROFIT',pnl_pct:pnlPct};
  if(maxPrice>entry&&drawdownPct<=-Math.abs(Number(rot.trailing_drawdown_pct??6))) return {exit:true,reason:'TRAILING_EXIT',pnl_pct:pnlPct};
  if(heldDays>=Number(rot.max_hold_days??14)) return {exit:true,reason:'MAX_HOLD',pnl_pct:pnlPct};
  if(heldDays>=Number(rot.soft_exit_after_days??3)&&(rot.soft_exit_actions||[]).includes(strategy?.action)) return {exit:true,reason:`SOFT_${strategy.action}`,pnl_pct:pnlPct};
  return {exit:false,reason:'HOLD',pnl_pct:+pnlPct.toFixed(2),held_days:+heldDays.toFixed(2),max_price:maxPrice};
}

export function candidateForStrategy(strategy,positions=[],policy={}){
  for(const c of strategy?.top5||[]){
    if(isProtectedSymbol(c.symbol,policy)) continue;
    if(c.broker_available!==true) continue;
    if(positions.some(p=>normalizeSymbol(p.symbol)===normalizeSymbol(c.symbol))) continue;
    if(!Number.isFinite(Number(c.market?.price))) continue;
    return c;
  }
  return null;
}

export function canOpenNewPosition(positions,policy){
  const active=positions.filter(p=>!isProtectedSymbol(p.symbol,policy));
  return active.length<Number(policy?.capital?.max_open_positions??6);
}
