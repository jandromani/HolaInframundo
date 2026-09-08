const text=e=>`${e?.signal||''} ${e?.claim||''} ${e?.source_name||''} ${e?.source_domain||''}`.toLowerCase();

export function guardMechanismEvidence(id,rows=[]){
  const accepted=[],rejected=[];
  for(const e of rows||[]){
    let reason=null;
    if(id==='CEYHAN_BYPASS'){
      const t=text(e);
      const ceyhan=/ceyhan|iraq[- ]turkey|iraq turkey|kirkuk[- ]ceyhan|kurdistan.{0,45}pipeline|pipeline.{0,45}(turkey|ceyhan)/i.test(t);
      if(!ceyhan)reason='CEYHAN_REQUIRES_PIPELINE_SPECIFIC_EVIDENCE';
    }
    if(reason)rejected.push({...e,semantic_rejection:reason});else accepted.push(e);
  }
  return {accepted,rejected};
}

export function pricingSensorMeta(id){
  if(id==='JAPAN_CARRY_UNWIND')return {scope:'EQUITY_PROXY_ONLY',confidence:'LOW',missing:['JGB_CURVE','USDJPY','BOJ_OIS','JAPAN_FOREIGN_BOND_FLOWS']};
  if(id==='CEYHAN_BYPASS')return {scope:'EQUITY_PROXY_ONLY',confidence:'LOW',missing:['CEYHAN_DAILY_FLOW','KURDISTAN_REALIZED_PRICE']};
  if(id==='UNDERWATER_SECURITY')return {scope:'EQUITY_PROXY_ONLY',confidence:'LOW',missing:['CONFIRMED_MINE_INCIDENTS','MCM_DEPLOYMENTS']};
  if(id==='GLOBAL_REFINANCING_STRESS')return {scope:'EQUITY_PROXY_ONLY',confidence:'MEDIUM',missing:['CREDIT_SPREADS','MOVE','REFINANCING_PRINTS']};
  if(id==='LNG_REROUTING')return {scope:'EQUITY_PLUS_LOGISTICS_PROXY',confidence:'MEDIUM',missing:['LNG_CHARTER_RATES','STS_UTILISATION']};
  return {scope:'EQUITY_CROSS_SECTION',confidence:'HIGH',missing:[]};
}
