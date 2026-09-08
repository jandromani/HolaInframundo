import fs from 'node:fs/promises';

const read=async(path,fallback)=>JSON.parse(await fs.readFile(path,'utf8').catch(()=>JSON.stringify(fallback)));
const current=await read('data/current.json',{mechanisms:{}});
const investment=await read('data/investment-layer.json',{strategies:{},summary:{}});
const briefing=await read('data/daily-briefing.json',{});
const failures=[],warnings=[];
const mechanisms=Object.values(current.mechanisms||{}),strategies=Object.values(investment.strategies||{});

if(mechanisms.length<20)failures.push(`current.json contains only ${mechanisms.length} mechanisms`);
if(strategies.length<20)failures.push(`investment-layer.json contains only ${strategies.length} strategies`);
if(Number(investment.summary?.candidate_rows||0)<=0)failures.push('investment-layer.json has zero candidate rows');
if(!current.run_id)failures.push('current.json has no run_id');
if(investment.run_id&&current.run_id&&investment.run_id!==current.run_id)failures.push(`investment/current run mismatch: ${investment.run_id} != ${current.run_id}`);

const ceyhan=current.mechanisms?.CEYHAN_BYPASS;
if(ceyhan){
  const bad=(ceyhan.evidence||[]).filter(e=>e?.valid!==false&&!/ceyhan|iraq[- ]turkey|kirkuk[- ]ceyhan|kurdistan.{0,45}pipeline|pipeline.{0,45}(turkey|ceyhan)/i.test(`${e.signal||''} ${e.claim||''}`));
  if(bad.length)warnings.push(`CEYHAN semantic contamination detected in ${bad.length} live evidence items`);
}

if(briefing.error){
  warnings.push(`briefing fallback: ${String(briefing.error).slice(0,180)}`);
  if(/invalid schema|response_format|strict schema/i.test(String(briefing.error)))failures.push('briefing judge failed because of a schema error');
}
if(process.env.OPENAI_API_KEY&&briefing.model==='deterministic-fallback'&&!briefing.error)warnings.push('OpenAI configured but briefing is deterministic fallback');
if(briefing.judge_health?.status==='OK'&&briefing.error)failures.push('judge_health says OK while briefing contains error');

const health={checked_at:new Date().toISOString(),run_id:current.run_id||null,status:failures.length?'FAIL':warnings.length?'DEGRADED':'OK',mechanisms:mechanisms.length,strategies:strategies.length,candidate_rows:Number(investment.summary?.candidate_rows||0),judge:briefing.judge_health||{status:briefing.model==='deterministic-fallback'?'DEGRADED_FALLBACK':'UNKNOWN'},failures,warnings};
await fs.writeFile('data/production-health.json',JSON.stringify(health,null,2)+'\n');
console.log(`healthcheck: ${health.status} mechanisms=${health.mechanisms} strategies=${health.strategies} candidates=${health.candidate_rows}`);
for(const w of warnings)console.warn(`health warning: ${w}`);
if(failures.length){for(const f of failures)console.error(`health failure: ${f}`);process.exit(1)}
