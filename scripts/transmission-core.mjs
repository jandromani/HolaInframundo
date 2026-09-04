export const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,Number.isFinite(Number(x))?Number(x):a));

const MODE_PRIORS={
  CYCLICAL_MARGIN:{operating_leverage:78,cash_conversion:58,balance:55,capex_readiness:58,convexity:60},
  FREIGHT_RATE:{operating_leverage:88,cash_conversion:68,balance:55,capex_readiness:50,convexity:72},
  COMMODITY_VOLUME:{operating_leverage:72,cash_conversion:62,balance:58,capex_readiness:62,convexity:65},
  VOLUME_RESTART:{operating_leverage:92,cash_conversion:55,balance:45,capex_readiness:60,convexity:86},
  LOGISTICS_MARGIN:{operating_leverage:82,cash_conversion:64,balance:55,capex_readiness:55,convexity:68},
  CONTRACT_BACKLOG:{operating_leverage:62,cash_conversion:70,balance:72,capex_readiness:72,convexity:52},
  COMPONENT_BOTTLENECK:{operating_leverage:78,cash_conversion:62,balance:62,capex_readiness:76,convexity:72},
  COMMODITY_PRICE:{operating_leverage:84,cash_conversion:58,balance:52,capex_readiness:60,convexity:70},
  VOLUME_SCALE:{operating_leverage:86,cash_conversion:48,balance:45,capex_readiness:72,convexity:82},
  POWER_EQUIPMENT:{operating_leverage:72,cash_conversion:72,balance:68,capex_readiness:82,convexity:62},
  BACKLOG_QUALITY:{operating_leverage:64,cash_conversion:72,balance:68,capex_readiness:70,convexity:58},
  POLICY_PROTECTION:{operating_leverage:68,cash_conversion:62,balance:64,capex_readiness:75,convexity:65},
  VOLATILITY_BENEFICIARY:{operating_leverage:55,cash_conversion:78,balance:75,capex_readiness:50,convexity:42},
  CREDIT_STRESS_BENEFICIARY:{operating_leverage:52,cash_conversion:72,balance:68,capex_readiness:60,convexity:45},
  CYBER_REMEDIATION:{operating_leverage:68,cash_conversion:85,balance:82,capex_readiness:75,convexity:58},
  CAPEX_CYCLE:{operating_leverage:88,cash_conversion:52,balance:42,capex_readiness:78,convexity:84}
};
const STRUCTURAL_WEIGHTS={exposure:.45,bottleneck:.275,margin_capture:.275};
const FINANCIAL_WEIGHTS={operating_leverage:.30,cash_conversion:.25,balance:.20,capex_readiness:.15,convexity:.10};
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const num=v=>finite(v)?Number(v):null;
const ratio=(a,b)=>finite(a)&&finite(b)&&Number(b)!==0?Number(a)/Number(b):null;
const scoreFcfMargin=x=>x==null?null:clamp(35+x*2.8,15,95);
const scoreLiabilities=x=>x==null?null:clamp(96-x*82,12,96);
const scoreCashDebt=x=>x==null?null:clamp(42+Math.min(2,x)*27,20,96);
const scoreCapexCoverage=x=>x==null?null:clamp(30+Math.min(4,x)*16,18,94);
const scoreConvexity=mc=>{if(!finite(mc)||Number(mc)<=0)return null;mc=Number(mc);if(mc<5e8)return 94;if(mc<1e9)return 90;if(mc<3e9)return 82;if(mc<1e10)return 72;if(mc<3e10)return 62;if(mc<1e11)return 52;if(mc<3e11)return 44;return 38};
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const weighted=(obj,w)=>Object.entries(w).reduce((s,[k,v])=>s+Number(obj[k]??50)*v,0);

export function structuralTransmission({fit,exposure='DIRECT',model={}}={}){
  const direct=String(exposure).toUpperCase()==='DIRECT',fitN=clamp(fit),defaults=model.defaults||{};
  const exposureScore=clamp(fitN*(direct?1:.62));
  const bottleneck=clamp((defaults.bottleneck??55)*(.72+.28*fitN/100)*(direct?1:.72));
  const marginCapture=clamp((defaults.margin_capture??55)*(.70+.30*fitN/100)*(direct?1:.76));
  const components={exposure:Math.round(exposureScore),bottleneck:Math.round(bottleneck),margin_capture:Math.round(marginCapture)};
  return {score:Math.round(clamp(weighted(components,STRUCTURAL_WEIGHTS))),components,weights:STRUCTURAL_WEIGHTS,direct,fit:Math.round(fitN)};
}

export function deriveFinancialScores(fundamental={},price=null,mode='CONTRACT_BACKLOG'){
  const p=MODE_PRIORS[mode]||MODE_PRIORS.CONTRACT_BACKLOG,x=fundamental.financials||fundamental||{};
  const revenue=num(x.revenue),prevRevenue=num(x.revenue_prev),op=num(x.operating_income),prevOp=num(x.operating_income_prev),cfo=num(x.cfo),capex=num(x.capex),assets=num(x.assets),liabilities=num(x.liabilities),cash=num(x.cash),debt=num(x.debt),explicitFcf=num(x.free_cash_flow);
  const capexAbs=capex==null?null:Math.abs(capex),debtAbs=debt==null?null:Math.abs(debt);

  let operatingLeverage=null;
  if(revenue!==null&&revenue!==0&&op!==null){
    const margin=op/revenue,prevMargin=prevRevenue!==null&&prevRevenue!==0&&prevOp!==null?prevOp/prevRevenue:null,revGrowth=prevRevenue!==null&&prevRevenue!==0?revenue/prevRevenue-1:null,opGrowth=prevOp!==null&&Math.abs(prevOp)>1?op/prevOp-1:null,sensitivity=revGrowth!=null&&opGrowth!=null?Math.min(5,Math.abs(opGrowth)/Math.max(.05,Math.abs(revGrowth))):null;
    operatingLeverage=clamp(48+(sensitivity==null?0:(sensitivity-1)*10)+Math.max(-.2,Math.min(.3,margin))*35+(prevMargin==null?0:(margin-prevMargin)*120),18,96);
  }
  const fcf=explicitFcf!==null?explicitFcf:cfo!==null&&capexAbs!==null?cfo-capexAbs:null,fcfMargin=fcf!=null&&revenue!==null&&revenue!==0?fcf/revenue*100:null,cashConversion=scoreFcfMargin(fcfMargin);
  const liabRatio=ratio(liabilities,assets),cashDebt=cash!==null&&debtAbs!==null&&debtAbs>0?cash/debtAbs:null,balance=avg([scoreLiabilities(liabRatio),scoreCashDebt(cashDebt)].filter(Number.isFinite));
  const capexCoverage=cfo!==null&&capexAbs!==null&&capexAbs>0?cfo/capexAbs:null,capexReadiness=scoreCapexCoverage(capexCoverage),shares=num(x.shares),px=num(price??fundamental.price),fallbackMc=num(fundamental.market_cap),marketCap=shares!==null&&shares>0&&px!==null&&px>0?shares*px:fallbackMc,convexity=scoreConvexity(marketCap);
  const raw={operating_leverage:operatingLeverage,cash_conversion:cashConversion,balance,capex_readiness:capexReadiness,convexity};
  const observed=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Number.isFinite(v)])),components=Object.fromEntries(Object.keys(FINANCIAL_WEIGHTS).map(k=>[k,Math.round(Number.isFinite(raw[k])?raw[k]:p[k])]));
  const observedWeight=Object.entries(FINANCIAL_WEIGHTS).reduce((s,[k,w])=>s+(observed[k]?w:0),0),financialScore=Math.round(clamp(weighted(components,FINANCIAL_WEIGHTS))),priorScore=Math.round(clamp(weighted(p,FINANCIAL_WEIGHTS)));
  return {
    ...components,
    components,observed,observed_weight:+observedWeight.toFixed(3),financial_score:financialScore,prior_score:priorScore,weights:FINANCIAL_WEIGHTS,
    source_quality:fundamental.quality||(observedWeight>=.7?'LIVE_FUNDAMENTALS':observedWeight>=.25?'PARTIAL_FUNDAMENTALS':'STRUCTURAL_ONLY'),
    metrics:{operating_margin:revenue!==null&&revenue!==0&&op!==null?+(op/revenue*100).toFixed(2):null,fcf_margin:fcfMargin==null?null:+fcfMargin.toFixed(2),liabilities_to_assets:liabRatio==null?null:+liabRatio.toFixed(3),cash_to_debt:cashDebt==null?null:+cashDebt.toFixed(2),cfo_to_capex:capexCoverage==null?null:+capexCoverage.toFixed(2),market_cap:marketCap!==null?Math.round(marketCap):null}
  };
}

export function transmissionLabel(score){if(score>=82)return 'HIGH_CONVEXITY';if(score>=70)return 'STRONG';if(score>=58)return 'MODERATE';return 'WEAK'}

export function scoreTransmission({fit,exposure='DIRECT',model={},fundamental={},price=null}={}){
  const pass1=structuralTransmission({fit,exposure,model}),fin=deriveFinancialScores(fundamental,price,model.mode),financialWeight=.40*fin.observed_weight,score=Math.round(clamp(pass1.score*(1-financialWeight)+fin.financial_score*financialWeight));
  const components={...pass1.components,...fin.components},fragility=Math.round(clamp((100-components.balance)*.5+(100-components.cash_conversion)*.25+Math.max(0,components.operating_leverage-75)*.25)),riskAdjusted=Math.round(clamp(score-fragility*.08)),confidence=Math.round(clamp(52+(pass1.direct?16:7)+fin.observed_weight*27));
  const ordered=Object.entries(components).sort((a,b)=>b[1]-a[1]),delta=score-pass1.score;
  const pass2={score:fin.financial_score,coverage:fin.observed_weight,weight_applied:+financialWeight.toFixed(3),delta,quality:fin.source_quality,components:fin.components,observed:fin.observed,prior_score:fin.prior_score};
  return {
    score,risk_adjusted_score:riskAdjusted,label:transmissionLabel(score),confidence,fragility,components,
    passes:{structural:{score:pass1.score,components:pass1.components,fit:pass1.fit,direct:pass1.direct},financial:pass2,final:{score,delta,risk_adjusted_score:riskAdjusted}},
    financials:fin.metrics,fundamental_quality:fin.source_quality,fundamental_coverage:fin.observed_weight,
    path:{shock:model.shock||'',earnings_channel:model.earnings_channel||'',bridge:model.bridge||[],diluters:model.diluters||[]},
    strongest:ordered.slice(0,3).map(([factor,value])=>({factor,value})),weakest:ordered.slice(-2).reverse().map(([factor,value])=>({factor,value})),
    explanation:`Pass 1 ${pass1.score}/100 (${pass1.direct?'direct':'second-order'} structural transmission). Pass 2 ${fin.financial_score}/100 with ${Math.round(fin.observed_weight*100)}% observed financial coverage; final ${score}/100 (${delta>=0?'+':''}${delta}).`,
    caveat:fin.observed_weight<.25?'Financial pass has low observed coverage, so it has little influence on the final score.':fin.observed_weight<.7?'Financial pass is partial; missing dimensions retain mechanism priors and influence is coverage-weighted.':null
  };
}
