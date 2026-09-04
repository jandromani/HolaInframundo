import fs from 'node:fs/promises';
import {isProtectedSymbol,normalizeSymbol} from '../lib/execution-core.mjs';

const policy=JSON.parse(await fs.readFile('config/execution-policy.json','utf8'));
const plan=JSON.parse(await fs.readFile('data/execution-plan.json','utf8').catch(()=>'{"exits":[],"entries":[],"topups":[]}'));
const market=JSON.parse(await fs.readFile('data/market.json','utf8').catch(()=>'{"metrics":{},"context":{}}'));
const portfolioPath='data/paper-portfolio.json',journalPath='data/trade-journal.json';
const portfolio=JSON.parse(await fs.readFile(portfolioPath,'utf8'));
const journal=JSON.parse(await fs.readFile(journalPath,'utf8'));
const now=new Date().toISOString();

if(policy.mode!=='SHADOW_ONLY'||policy.execution?.auto_live_orders!==false) throw new Error('Execution policy must remain SHADOW_ONLY with auto_live_orders=false');
if((portfolio.positions||[]).some(p=>isProtectedSymbol(p.symbol,policy))) throw new Error('Protected SGMOQ must never enter the GearWatch paper sleeve');

let cash=Number(portfolio.cash_usd||0),realized=Number(portfolio.realized_pnl_usd||0),positions=[...(portfolio.positions||[])];
const trades=[];
const pxFor=symbol=>Number(market.metrics?.[symbol]?.price);
const findPos=s=>positions.findIndex(p=>normalizeSymbol(p.symbol)===normalizeSymbol(s));
const tradeId=(side,symbol)=>`${plan.run_id||'run'}_${side}_${normalizeSymbol(symbol)}_${Date.now()}`;

function addTrade(t){trades.push({...t,id:tradeId(t.side,t.symbol),timestamp:now,mode:'SHADOW_ONLY',run_id:plan.run_id||null})}

for(const x of plan.exits||[]){
  if(isProtectedSymbol(x.symbol,policy)) continue;
  const i=findPos(x.symbol);if(i<0)continue;
  const p=positions[i],px=pxFor(p.symbol);if(!Number.isFinite(px)||px<=0)continue;
  const proceeds=Number(p.quantity)*px,pnl=proceeds-Number(p.cost_usd||0);
  cash+=proceeds;realized+=pnl;
  positions.splice(i,1);
  addTrade({side:'SELL',position_id:p.id,symbol:p.symbol,mechanism_id:p.mechanism_id,risk_group:p.risk_group,quantity:Number(p.quantity),price:px,notional_usd:+proceeds.toFixed(2),realized_pnl_usd:+pnl.toFixed(2),reason:x.reason});
}

for(const x of plan.entries||[]){
  if(isProtectedSymbol(x.symbol,policy)) continue;
  if(findPos(x.symbol)>=0)continue;
  if(positions.length>=Number(policy.capital.max_open_positions||6))break;
  const px=pxFor(x.symbol);if(!Number.isFinite(px)||px<=0)continue;
  const maxOrder=Number(policy.capital.max_order_usd||80),notional=Math.min(Number(x.usd||0),cash,maxOrder);
  if(notional<10)continue;
  const qty=notional/px,positionId=`paper_${plan.run_id||Date.now()}_${normalizeSymbol(x.symbol)}`;
  positions.push({
    id:positionId,
    symbol:x.symbol,mechanism_id:x.mechanism_id,risk_group:x.risk_group,opened_at:now,
    entry_price:px,current_price:px,max_price:px,quantity:+qty.toFixed(6),cost_usd:+notional.toFixed(2),market_value_usd:+notional.toFixed(2),
    unrealized_pnl_usd:0,entry_action:x.action,entry_wave:x.wave_phase,entry_opportunity_score:x.opportunity_score,entry_transmission_score:x.transmission_score
  });
  cash-=notional;
  addTrade({side:'BUY',position_id:positionId,symbol:x.symbol,mechanism_id:x.mechanism_id,risk_group:x.risk_group,quantity:+qty.toFixed(6),price:px,notional_usd:+notional.toFixed(2),reason:x.reason,entry_action:x.action,entry_wave:x.wave_phase});
}

for(const x of plan.topups||[]){
  if(isProtectedSymbol(x.symbol,policy)) continue;
  const i=findPos(x.symbol);if(i<0)continue;
  const p=positions[i],px=pxFor(p.symbol);if(!Number.isFinite(px)||px<=0)continue;
  if(policy.rotation?.never_average_down&&px<Number(p.entry_price))continue;
  const room=Math.max(0,Number(policy.capital.max_symbol_exposure_usd||100)-Number(p.cost_usd||0)),notional=Math.min(Number(x.usd||0),cash,Number(policy.capital.max_order_usd||80),room);
  if(notional<5)continue;
  const qty=notional/px,newQty=Number(p.quantity)+qty,newCost=Number(p.cost_usd)+notional,newEntry=newCost/newQty;
  positions[i]={...p,quantity:+newQty.toFixed(6),cost_usd:+newCost.toFixed(2),entry_price:+newEntry.toFixed(6),current_price:px,max_price:Math.max(Number(p.max_price||px),px)};
  cash-=notional;
  addTrade({side:'BUY_TOPUP',position_id:p.id,symbol:p.symbol,mechanism_id:p.mechanism_id,risk_group:p.risk_group,quantity:+qty.toFixed(6),price:px,notional_usd:+notional.toFixed(2),reason:x.reason});
}

let marketValue=0,unrealized=0;
positions=positions.map(p=>{
  const px=pxFor(p.symbol),current=Number.isFinite(px)&&px>0?px:Number(p.current_price||p.entry_price),mv=Number(p.quantity)*current,u=mv-Number(p.cost_usd||0),maxPrice=Math.max(Number(p.max_price||p.entry_price),current);
  marketValue+=mv;unrealized+=u;
  return {...p,current_price:+current.toFixed(6),max_price:+maxPrice.toFixed(6),market_value_usd:+mv.toFixed(2),unrealized_pnl_usd:+u.toFixed(2),updated_at:now};
});

const initial=Number(policy.capital.initial_budget_usd||500),nav=cash+marketValue,botReturn=((nav/initial)-1)*100;
const qqq=Number(market.context?.QQQ?.price),spx=Number(market.context?.['^GSPC']?.price);
const priorBench=portfolio.benchmark||{};
const benchmark={
  started_at:priorBench.started_at||now,
  qqq_start:Number(priorBench.qqq_start)|| (Number.isFinite(qqq)&&qqq>0?qqq:null),
  spx_start:Number(priorBench.spx_start)|| (Number.isFinite(spx)&&spx>0?spx:null),
  qqq_current:Number.isFinite(qqq)&&qqq>0?qqq:null,
  spx_current:Number.isFinite(spx)&&spx>0?spx:null
};
benchmark.qqq_return_pct=benchmark.qqq_start&&benchmark.qqq_current?+(((benchmark.qqq_current/benchmark.qqq_start)-1)*100).toFixed(2):null;
benchmark.spx_return_pct=benchmark.spx_start&&benchmark.spx_current?+(((benchmark.spx_current/benchmark.spx_start)-1)*100).toFixed(2):null;
benchmark.qqq_nav_usd=benchmark.qqq_return_pct==null?null:+(initial*(1+benchmark.qqq_return_pct/100)).toFixed(2);
benchmark.spx_nav_usd=benchmark.spx_return_pct==null?null:+(initial*(1+benchmark.spx_return_pct/100)).toFixed(2);
benchmark.alpha_vs_qqq_pct=benchmark.qqq_return_pct==null?null:+(botReturn-benchmark.qqq_return_pct).toFixed(2);
benchmark.alpha_vs_spx_pct=benchmark.spx_return_pct==null?null:+(botReturn-benchmark.spx_return_pct).toFixed(2);

const next={
  ...portfolio,version:'3.0.0',mode:'SHADOW_ONLY',generated_at:now,initial_budget_usd:initial,
  cash_usd:+cash.toFixed(2),market_value_usd:+marketValue.toFixed(2),nav_usd:+nav.toFixed(2),
  realized_pnl_usd:+realized.toFixed(2),unrealized_pnl_usd:+unrealized.toFixed(2),positions,benchmark,
  protected_external_positions:policy.protected_symbols||[],
  stats:{
    open_positions:positions.length,
    available_slots:Math.max(0,Number(policy.capital.max_open_positions||6)-positions.length),
    total_return_pct:+botReturn.toFixed(2),
    alpha_vs_qqq_pct:benchmark.alpha_vs_qqq_pct,
    alpha_vs_spx_pct:benchmark.alpha_vs_spx_pct
  }
};

journal.trades=[...(journal.trades||[]),...trades].slice(-2000);journal.generated_at=now;
const closed=journal.trades.filter(t=>t.side==='SELL'),wins=closed.filter(t=>Number(t.realized_pnl_usd)>0),losses=closed.filter(t=>Number(t.realized_pnl_usd)<0);
journal.stats={entries:journal.trades.filter(t=>['BUY','BUY_TOPUP'].includes(t.side)).length,exits:closed.length,wins:wins.length,losses:losses.length,win_rate:closed.length?+(wins.length/closed.length*100).toFixed(1):null,avg_win_usd:wins.length?+(wins.reduce((a,t)=>a+Number(t.realized_pnl_usd||0),0)/wins.length).toFixed(2):null,avg_loss_usd:losses.length?+(losses.reduce((a,t)=>a+Number(t.realized_pnl_usd||0),0)/losses.length).toFixed(2):null,realized_pnl_usd:+closed.reduce((a,t)=>a+Number(t.realized_pnl_usd||0),0).toFixed(2)};

await fs.writeFile(portfolioPath,JSON.stringify(next,null,2)+'\n');await fs.writeFile(journalPath,JSON.stringify(journal,null,2)+'\n');
console.log(`paper execution: trades=${trades.length} open=${positions.length} cash=$${next.cash_usd} nav=$${next.nav_usd} alphaQQQ=${benchmark.alpha_vs_qqq_pct??'n/a'} SGMOQ=ISOLATED`);
