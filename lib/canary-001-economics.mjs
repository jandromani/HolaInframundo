// Canary-001: observable financial transmission, NOT a stock-price forecast.
// LSB Q2 product netback is selling price minus freight/other non-netback costs,
// NOT contribution margin, EBITDA, cash-flow or shareholder value.
import {bayesianUpdate,monteCarlo} from './canary-probability.mjs';
const number=x=>typeof x==='number'&&Number.isFinite(x);
const allowedShifts=x=>number(x?.price_pct)&&number(x?.volume_pct)&&
  x.price_pct>=-100&&x.price_pct<=300&&x.volume_pct>=-100&&x.volume_pct<=300;
const round=(v,d=2)=>Number(v.toFixed(d));
function assertValidConfig(c){
 if(c?.experiment_id!=='CANARY-001')throw new Error('Wrong experiment');
 const b=c.historical_baseline||{},lines=b.product_lines;
 if(!Array.isArray(lines)||lines.length!==3)throw new Error('Exactly three reported core product lines required');
 const ids=new Set();
 for(const line of lines){
  if(!line.id||ids.has(line.id)||!number(line.volume_short_tons)||line.volume_short_tons<=0||
     !number(line.netback_usd_per_short_ton)||line.netback_usd_per_short_ton<0)
   throw new Error('Invalid or duplicate historical product line');
  ids.add(line.id);
 }
 if(!number(b.reported_netback_sales_usd)||b.reported_netback_sales_usd<=0||
    !Array.isArray(c.scenarios)||c.scenarios.length!==3||c.constraints?.scenario_probabilities!==null)
  throw new Error('Missing sourced netback or unexpected fabricated scenario weights');
 for(const s of c.scenarios){
  for(const id of ids)if(!allowedShifts(s.shifts?.[id]))throw new Error('Missing/bad stress parameters '+s.id+':'+id);
  if(Object.keys(s.shifts).length!==ids.size)throw new Error('Extra scenario product line');
 }
 if(!/^https:\/\//.test(c.source?.url||'')||!c.source?.period_end||!c.source?.published_at)
  throw new Error('Company statement provenance missing');
 return b;
}
export function buildCanaryEconomics(config,{asOf=new Date().toISOString(),market=null,evidence=null}={}){
 const base=assertValidConfig(config);
 if(Date.parse(config.source.published_at)>Date.parse(asOf))throw new Error('Future source publication');
 const rows=base.product_lines.map(p=>({
   id:p.id,label:p.label,volume_short_tons:p.volume_short_tons,
   netback_usd_per_short_ton:p.netback_usd_per_short_ton,
   quarterly_netback_usd:p.volume_short_tons*p.netback_usd_per_short_ton
 }));
 const reconstructed=rows.reduce((s,p)=>s+p.quarterly_netback_usd,0);
 const reconciliationGap=base.reported_netback_sales_usd-reconstructed;
 // Rounded per-ton published prices imply a harmless reconciliation gap.
 if(Math.abs(reconciliationGap)>rows.reduce((s,p)=>s+p.volume_short_tons,0))
  throw new Error('Reported netback does not reconcile to published per-ton figures');
 const scenarios=config.scenarios.map(s=>{
  const product_lines=rows.map(p=>{
   const v=s.shifts[p.id],volume=p.volume_short_tons*(1+v.volume_pct/100),
   sellingNetback=p.netback_usd_per_short_ton*(1+v.price_pct/100);
   const scenario_netback_usd=volume*sellingNetback,
   delta_netback_usd=scenario_netback_usd-p.quarterly_netback_usd;
   return {id:p.id,price_shift_pct:v.price_pct,volume_shift_pct:v.volume_pct,
    stressed_volume_short_tons:round(volume,2),stressed_netback_per_short_ton:round(sellingNetback,2),
    scenario_product_netback_usd:round(scenario_netback_usd),
    delta_product_netback_usd:round(delta_netback_usd)};
  });
  const delta=product_lines.reduce((sum,row)=>sum+row.delta_product_netback_usd,0);
  return {id:s.id,title:s.title,kind:s.kind,weight:null,
   delta_netback_sales_usd:round(delta),
   stressed_netback_sales_usd:round(base.reported_netback_sales_usd+delta),
   product_lines,
   incremental_ebitda_usd:null,incremental_free_cash_flow_usd:null,
   equity_value_usd:null,expected_stock_return:null,
   missing_for_ebitda:['Gas consumed per unit and hedges','Variable manufacturing costs','Mix/capacity constraints'],
   warning:'Netback-sales sensitivity ONLY. Not a margin or cash-flow estimate.'};
 });
 const prob=bayesianUpdate({
  prior:evidence?.prior||null,
  evidence:evidence?.likelihood_events||[],
  calibration:evidence?.calibration||null,
  asOf
 });
 // Future functionality is gated by independently validated distributions.
 // Never feed arbitrarily selected stress scenarios into Monte Carlo.
 const mc=monteCarlo({drivers:evidence?.validated_distributions||[],
  calibration:evidence?.distribution_calibration||null,seed:1001,samples:4000});
 return {
  schema_version:'1.0.0',experiment_id:'CANARY-001',as_of:asOf,
  methodology:'STRUCTURAL_ECONOMICS_WITH_PROBABILITY_GATES',
  source:config.source,
  baseline:{
   products:rows,
   reconstructed_netback_sales_usd:reconstructed,
   reported_netback_sales_usd:base.reported_netback_sales_usd,
   reconciliation_gap_usd:reconciliationGap,
   reported_adjusted_ebitda_usd:base.reported_adjusted_ebitda_usd,
   realized_gas_input_cost_usd_per_mmbtu:base.realized_gas_input_cost_usd_per_mmbtu,
   net_debt_usd:base.balance_sheet.total_debt_usd-base.balance_sheet.cash_plus_short_term_usd,
   period:base.period,time_unit:base.time_unit,affected_by_turnarounds:base.base_historical_quarter_affected_by_plant_turnarounds
  },
  scenarios,
  bayesian_state:prob,
  stochastic_model:mc,
  probabilistic_status:prob.status==='CALIBRATED_POINT_ESTIMATE'&&mc.status==='CONDITIONAL_DISTRIBUTION_ESTIMATE'?
   'PARTIALLY_CALIBRATED_COMPONENTS':'UNIDENTIFIED',
  expected_ebitda_usd:null,
  expected_free_cash_flow_usd:null,
  expected_return_pct:null,
  probability_of_outperformance:null,
  probability_of_permanent_capital_loss:null,
  market_expectations_status:'NOT_ESTIMATED',
  company_margin_bridge_status:'NETBACK_ONLY',
  company_comparator_status:'CF_NOT_MODELED',
  primary_measured_shock_status:'NO_HORMUZ_FERTILIZER_FLOW_TIME_SERIES',
  source_data_cutoff:config.source.published_at,
  limits:config.calibration_requirements,
  ethics:{real_money_orders:false,forecast_available:false,
   alert:'Illustrative sensitivity. No calibrated probability or expected equity return.'}
 };
}
