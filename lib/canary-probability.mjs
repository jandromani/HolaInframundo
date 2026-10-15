// GearWatch probability kernel. Pure, deterministic and fail-closed.
// Probabilities are only published when the prior, likelihood ratios and dependence
// assumptions have held-out calibration provenance. Research scores != probabilities.
const isNum=x=>typeof x==='number'&&Number.isFinite(x);
const p01=x=>isNum(x)&&x>0&&x<1;
const url=x=>{try{return /^https?:$/.test(new URL(x).protocol)}catch{return false}};
const failure=(reason,details={})=>({status:'UNCALIBRATED',probability:null,credible_interval:null,reason,...details});
const verifiedCalibration=c=>c?.status==='VALIDATED_OUT_OF_SAMPLE'&&
 Number.isInteger(c.sample_size)&&c.sample_size>=50&&url(c.source_url)&&
 c.dependencies_reviewed===true&&typeof c.calibrated_at==='string'&&Number.isFinite(Date.parse(c.calibrated_at));
export function bayesianUpdate({prior=null,evidence=[],calibration=null,asOf=new Date().toISOString()}={}){
 if(!verifiedCalibration(calibration))return failure('INDEPENDENT_CALIBRATION_MISSING');
 if(!prior||!p01(prior.value)||!url(prior.source_url)||!Number.isFinite(Date.parse(prior.as_of||'')))
  return failure('DEFENSIBLE_PRIOR_MISSING');
 if(Date.parse(prior.as_of)>Date.parse(asOf)||Date.parse(calibration.calibrated_at)>Date.parse(asOf))
  return failure('FUTURE_INFORMATION_DISALLOWED');
 const groups=new Map(),skipped=[];
 for(const e of evidence){
  if(!e?.event_id||!e?.dependency_group||!url(e.source_url)||
    !isNum(e.likelihood_ratio)||e.likelihood_ratio<=0||
    e.calibration_id!==calibration.id||!Number.isFinite(Date.parse(e.observed_at||''))||
    Date.parse(e.observed_at)>Date.parse(asOf)){
   skipped.push({event_id:e?.event_id||null,reason:'INVALID_OR_FUTURE_EVIDENCE'});continue;
  }
  const g=groups.get(e.dependency_group)||[];
  if(g.some(x=>x.event_id===e.event_id)){skipped.push({event_id:e.event_id,reason:'DUPLICATE_EVENT'});continue}
  g.push(e);groups.set(e.dependency_group,g);
 }
 let odds=prior.value/(1-prior.value);
 const applied=[],conflicted=[];
 for(const [group,events] of groups){
  const directions=new Set(events.map(e=>e.likelihood_ratio>1?'UP':e.likelihood_ratio<1?'DOWN':'FLAT'));
  if(directions.has('UP')&&directions.has('DOWN')){
   conflicted.push(group);continue;
  }
  // Correlated reports from a single dependency group count as only ONE
  // observation (the strongest valid event), never as independent multipliers.
  const strongest=[...events].sort((a,b)=>Math.abs(Math.log(b.likelihood_ratio))-Math.abs(Math.log(a.likelihood_ratio)))[0];
  const lr=Math.max(1/20,Math.min(20,strongest.likelihood_ratio));
  odds*=lr;
  applied.push({dependency_group:group,event_id:strongest.event_id,
   likelihood_ratio_applied:lr,source_url:strongest.source_url,
   reports_in_group:events.length,clipped:lr!==strongest.likelihood_ratio});
 }
 return {status:'CALIBRATED_POINT_ESTIMATE',probability:odds/(1+odds),
  credible_interval:null,interval_status:'UNCALCULATED_REQUIRES_PARAMETER_UNCERTAINTY',
  prior:prior.value,applied,conflicted_groups:conflicted,skipped,
  sample_size:calibration.sample_size,calibration_id:calibration.id,
  interpretation:'A calibrated conditional estimate, not certainty or investment advice.'};
}
function rng32(seed){
 let state=seed>>>0;
 return ()=>{state=(state+0x6D2B79F5)|0;let t=Math.imul(state^(state>>>15),1|state);
  t^=t+Math.imul(t^(t>>>7),61|t);
  return ((t^(t>>>14))>>>0)/4294967296};
}
function normal(rng){const u=Math.max(1e-15,rng()),v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
const quantile=(a,q)=>{const p=(a.length-1)*q,i=Math.floor(p),f=p-i;return a[i]*(1-f)+(a[Math.min(i+1,a.length-1)]||a[i])*f};
export function monteCarlo({drivers=[],calibration=null,seed=42,samples=4000}={}){
 if(!verifiedCalibration(calibration))return {status:'UNCALIBRATED',quantiles:null,expected_value:null,reason:'MONTE_CARLO_REQUIRES_EMPIRICAL_INPUT_DISTRIBUTIONS'};
 if(!Array.isArray(drivers)||!drivers.length||drivers.length>20||!Number.isInteger(samples)||samples<500||samples>50000||
    !Number.isInteger(seed)||!drivers.every(d=>isNum(d.mean)&&isNum(d.stddev)&&d.stddev>=0&&
      isNum(d.coefficient)&&isNum(d.shared_factor_loading)&&Math.abs(d.shared_factor_loading)<=1&&
      d.calibration_id===calibration.id))
  return {status:'INVALID_MODEL',quantiles:null,expected_value:null,reason:'MODEL_INPUTS_NOT_VERIFIED'};
 const rng=rng32(seed),values=[];
 for(let i=0;i<samples;i++){
  const shared=normal(rng);let sum=0;
  for(const d of drivers){
   const z=d.shared_factor_loading*shared+Math.sqrt(1-d.shared_factor_loading**2)*normal(rng);
   sum+=d.coefficient*(d.mean+d.stddev*z);
  }
  values.push(sum);
 }
 values.sort((a,b)=>a-b);
 return {status:'CONDITIONAL_DISTRIBUTION_ESTIMATE',samples,seed,
  expected_value:values.reduce((a,b)=>a+b,0)/samples,
  quantiles:{p05:quantile(values,.05),p50:quantile(values,.5),p95:quantile(values,.95)},
  calibration_id:calibration.id,warning:'Conditional on empirically calibrated inputs. Gaussian factor approximation may miss tails and regime breaks.'};
}
export function brierScore(forecasts=[]){
 if(!Array.isArray(forecasts)||!forecasts.length)return {status:'INSUFFICIENT_OUTCOMES',score:null,n:0};
 if(!forecasts.every(x=>p01(x.p)&&[0,1].includes(x.outcome)&&x.committed_before_outcome===true))
  return {status:'INVALID_OR_UNREGISTERED_FORECASTS',score:null,n:0};
 if(forecasts.length<30)return {status:'INSUFFICIENT_OUTCOMES',score:null,n:forecasts.length};
 const score=forecasts.reduce((s,x)=>s+(x.p-x.outcome)**2,0)/forecasts.length;
 return {status:'EVALUATED',score,n:forecasts.length,warning:'Compare against base-rate forecast and stratify by market regime.'};
}
