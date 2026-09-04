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

const ratio=(a,b)=>Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Number(b)!==0?Number(a)/Number(b):null;
const pct=(a,b)=>{const r=ratio(a,b);return r==null?null:r*100};
const scoreFcfMargin=x=>x==null?null:clamp(35+x*2.8,15,95);
const scoreLiabilities=x=>x==null?null:clamp(96-x*82,12,96);
const scoreCashDebt=x=>x==null?null:clamp(42+Math.min(2,x)*27,20,96);
const scoreCapexCoverage=x=>x==null?null:clamp(30+Math.min(4,x)*16,18,94);
const scoreConvexity=mc=>{
  if(!Number.isFinite(mc)||mc<=0)return null;
  if(mc<5e8)return 94;if(mc<1e9)return 90;if(mc<3e9)return 82;if(mc<1e10)return 72;if(mc<3e10)return 62;if(mc<1e11)return 52;if(mc<3e11)return 44;return 38;
};
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;

export function deriveFinancialScores(fundamental={},price=null,mode='CONTRACT_BACKLOG'){
  const p=MODE_PRIORS[mode]||MODE_PRIORS.CONTRACT_BACKLOG;
  const x=fundamental.financials||fundamental||{};
  const coverageFields=['revenue','operating_income','cfo','capex','assets','liabilities','cash','debt'];
  const observed=coverageFields.filter(k=>Number.isFinite(Number(x[k]))).length;
  const coverage=observed/coverageFields.length;
  const revenue=Number(x.revenue),prevRevenue=Number(x.revenue_prev),op=Number(x.operating_income),prevOp=Number(x.operating_income_prev),cfo=Number(x.cfo),capex=Math.abs(Number(x.capex)),assets=Number(x.assets),liabilities=Number(x.liabilities),cash=Number(x.cash),debt=Math.abs(Number(x.debt));

  let operatingLeverage=null;
  if(Number.isFinite(revenue)&&revenue!==0&&Number.isFinite(op)){
    const margin=op/revenue;
    const prevMargin=Number.isFinite(prevRevenue)&&prevRevenue!==0&&Number.isFinite(prevOp)?prevOp/prevRevenue:null;
    const revGrowth=Number.isFinite(prevRevenue)&&prevRevenue!==0?revenue/prevRevenue-1:null;
    const opGrowth=Number.isFinite(prevOp)&&Math.abs(prevOp)>1?op/prevOp-1:null;
    const sensitivity=revGrowth!=null&&opGrowth!=null?Math.min(5,Math.abs(opGrowth)/Math.max(.05,Math.abs(revGrowth))):null;
    operatingLeverage=clamp(48+(sensitivity==null?0:(sensitivity-1)*10)+Math.max(-.2,Math.min(.3,margin))*35+(prevMargin==null?0:(margin-prevMargin)*120),18,96);
  }

  const fcf=Number.isFinite(cfo)&&Number.isFinite(capex)?cfo-capex:null;
  const fcfMargin=fcf!=null&&Number.isFinite(revenue)&&revenue!==0?fcf/revenue*100:null;
  const cashConversion=scoreFcfMargin(fcfMargin);
  const liabRatio=Number.isFinite(liabilities)&&Number.isFinite(assets)&&assets!==0?liabilities/assets:null;
  const cashDebt=Number.isFinite(cash)&&Number.isFinite(debt)&&debt>0?cash/debt:null;
  const balanceParts=[scoreLiabilities(liabRatio),scoreCashDebt(cashDebt)].filter(Number.isFinite);
  const balance=avg(balanceParts);
  const capexCoverage=Number.isFinite(cfo)&&Number.isFinite(capex)&&capex>0?cfo/capex:null;
  const capexReadiness=scoreCapexCoverage(capexCoverage);
  const shares=Number(x.shares),px=Number(price??fundamental.price),marketCap=Number.isFinite(shares)&&shares>0&&Number.isFinite(px)&&px>0?shares*px:Number(fundamental.market_cap);
  const convexity=scoreConvexity(marketCap);

  const use=(v,k)=>Number.isFinite(v)?Math.round(v):p[k];
  return {
    operating_leverage:use(operatingLeverage,'operating_leverage'),
    cash_conversion:use(cashConversion,'cash_conversion'),
    balance:use(balance,'balance'),
    capex_readiness:use(capexReadiness,'capex_readiness'),
    convexity:use(convexity,'convexity'),
    coverage:+coverage.toFixed(3),
    source_quality:fundamental.quality|| (coverage>=.75?'LIVE_FUNDAMENTALS':coverage>=.25?'PARTIAL_FUNDAMENTALS':'STRUCTURAL_ONLY'),
    metrics:{
      operating_margin:Number.isFinite(revenue)&&revenue!==0&&Number.isFinite(op)?+(op/revenue*100).toFixed(2):null,
      fcf_margin:fcfMargin==null?null:+fcfMargin.toFixed(2),
      liabilities_to_assets:liabRatio==null?null:+liabRatio.toFixed(3),
      cash_to_debt:cashDebt==null?null:+cashDebt.toFixed(2),
      cfo_to_capex:capexCoverage==null?null:+capexCoverage.toFixed(2),
      market_cap:Number.isFinite(marketCap)?Math.round(marketCap):null
    }
  };
}

export function transmissionLabel(score){if(score>=82)return 'HIGH_CONVEXITY';if(score>=70)return 'STRONG';if(score>=58)return 'MODERATE';return 'WEAK'}

export function scoreTransmission({fit,exposure='DIRECT',model={},fundamental={},price=null,weights=null}={}){
  const w=weights||{exposure:.30,bottleneck:.15,margin_capture:.15,operating_leverage:.12,cash_conversion:.10,balance:.08,capex_readiness:.05,convexity:.05};
  const direct=String(exposure).toUpperCase()==='DIRECT';
  const fitN=clamp(fit);
  const directFactor=direct?1:.62;
  const exposureScore=clamp(fitN*directFactor);
  const defaults=model.defaults||{};
  const bottleneck=clamp((defaults.bottleneck??55)*(.72+.28*fitN/100)*(direct?1:.72));
  const marginCapture=clamp((defaults.margin_capture??55)*(.70+.30*fitN/100)*(direct?1:.76));
  const fin=deriveFinancialScores(fundamental,price,model.mode);
  const components={
    exposure:Math.round(exposureScore),bottleneck:Math.round(bottleneck),margin_capture:Math.round(marginCapture),
    operating_leverage:fin.operating_leverage,cash_conversion:fin.cash_conversion,balance:fin.balance,capex_readiness:fin.capex_readiness,convexity:fin.convexity
  };
  const score=Math.round(clamp(Object.entries(w).reduce((s,[k,v])=>s+(components[k]??50)*v,0)));
  const fragility=Math.round(clamp((100-components.balance)*.5+(100-components.cash_conversion)*.25+Math.max(0,components.operating_leverage-75)*.25));
  const riskAdjusted=Math.round(clamp(score-fragility*.08));
  const confidence=Math.round(clamp(45+(direct?20:7)+fin.coverage*35));
  const ordered=Object.entries(components).sort((a,b)=>b[1]-a[1]);
  return {
    score,risk_adjusted_score:riskAdjusted,label:transmissionLabel(score),confidence,fragility,
    components,financials:fin.metrics,fundamental_quality:fin.source_quality,fundamental_coverage:fin.coverage,
    path:{shock:model.shock||'',earnings_channel:model.earnings_channel||'',bridge:model.bridge||[],diluters:model.diluters||[]},
    strongest:ordered.slice(0,3).map(([factor,value])=>({factor,value})),weakest:ordered.slice(-2).reverse().map(([factor,value])=>({factor,value})),
    explanation:`${direct?'Direct':'Second-order'} exposure; structural fit ${Math.round(fitN)}/100. Transmission is strongest through ${ordered.slice(0,2).map(x=>x[0].replaceAll('_',' ')).join(' + ')}.`,
    caveat:fin.coverage<.25?'Financial pass-through uses mechanism priors because standardized fundamentals are unavailable; confidence is reduced.':null
  };
}
