import fs from 'node:fs/promises';
import {mapConcurrent,normalizeParsed,parseModelJson,validParsed} from './extract-core.mjs';

const API_KEY=process.env.OPENROUTER_API_KEY;if(!API_KEY){console.error('OPENROUTER_API_KEY missing');process.exit(2)}
const policy=JSON.parse(await fs.readFile('config/policy.v2.json','utf8'));
const mechCfg=JSON.parse(await fs.readFile('config/mechanisms.json','utf8'));
const retrieval=JSON.parse(await fs.readFile('data/retrieval/latest.json','utf8'));
const previous=JSON.parse(await fs.readFile('data/current.json','utf8').catch(()=>'{"mechanisms":{}}'));
const quota=JSON.parse(await fs.readFile('data/openrouter-quota.json','utf8').catch(()=>'{"extraction_daily_cap":46}'));
const budgetPath='data/budget.json',healthPath='data/model-health.json';
const budget=JSON.parse(await fs.readFile(budgetPath,'utf8').catch(()=>'{"days":{}}'));
const modelHealth=JSON.parse(await fs.readFile(healthPath,'utf8').catch(()=>'{"version":"2.4.0","models":{}}'));modelHealth.version='2.4.0';
const now=new Date(),day=now.toISOString().slice(0,10);
budget.days[day]??={llm:0,web:0,extraction:0,verifier:0,extractor_paid_usd:0};budget.days[day].extraction??=0;budget.days[day].extractor_paid_usd??=0;
const PRIMARY=process.env.OPENROUTER_MODEL||policy.model||'openai/gpt-oss-20b';
const FALLBACK=policy.extractor?.fallback_model||'openai/gpt-oss-120b';
const PAID_CAP=Number(policy.budgets?.max_paid_extractor_usd_per_day||.05);
const CONCURRENCY=Math.max(1,Math.min(4,Number(policy.extractor?.concurrency||3)));
const MAX_REPAIRS=Math.max(0,Math.min(1,Number(policy.extractor?.max_repair_attempts??1)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const domainOf=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''}};
const gradeDomain=d=>{d=String(d||'').toLowerCase();if(!d)return .45;if(d.endsWith('.gov')||d.endsWith('.mil')||d.endsWith('.int')||['federalreserve.gov','ecb.europa.eu','boj.or.jp','opec.org','iea.org','eia.gov','sec.gov','nato.int','federalregister.gov'].some(x=>d===x||d.endsWith('.'+x)))return 1;if(['reuters.com','bloomberg.com','ft.com','apnews.com','wsj.com'].some(x=>d===x||d.endsWith('.'+x)))return .92;if(['spglobal.com','argusmedia.com','tradewindsnews.com','lloydslist.com','offshore-energy.biz','defensenews.com','breakingdefense.com'].some(x=>d===x||d.endsWith('.'+x)))return .82;return .62};
const SYSTEM=`You are the extraction layer of GearWatch. You do not browse and you never decide whether a market mechanism is active. You receive a closed deterministic candidate set. Select only atomic claims supported by those candidates. candidate_id MUST exactly match an input candidate. Never invent URLs, numbers, dates or sources. Prefer official upstream evidence, then primary/company/regulatory evidence, then high-quality reporting. LEAD is precursor evidence; CONFIRM is the physical/economic variable that should move; LAG is late earnings/headline evidence. Multiple mirrors of the same event are not multiple facts. Omit ambiguity. Return one JSON object only.`;
const REPAIR_SYSTEM=`You repair JSON for a deterministic market-intelligence pipeline. Do not add facts. Preserve only content already present in the broken response. Return exactly one JSON object matching the supplied schema.`;
const schema={type:'object',additionalProperties:false,properties:{summary:{type:'string'},items:{type:'array',items:{type:'object',additionalProperties:false,properties:{candidate_id:{type:'string'},fact_type:{type:'string',enum:['FACT','INFERENCE']},claim:{type:'string'},direction:{type:'string',enum:['UP','DOWN','FLAT','MIXED','UNKNOWN']},relevance:{type:'number',minimum:0,maximum:1},contradiction:{type:'boolean'},why_upstream:{type:'string'}},required:['candidate_id','fact_type','claim','direction','relevance','contradiction','why_upstream']}},expected_next:{type:'array',items:{type:'string'}},invalidation:{type:'array',items:{type:'string'}}},required:['summary','items','expected_next','invalidation']};
function health(model){return modelHealth.models[model]??={success:0,fail:0,http404:0,http429:0,schema_fail:0,parse_fail:0,repairs:0,total_ms:0,last_error:null,last_success:null,last_used:null}}
function costOf(response){const n=Number(response?.usage?.cost??response?.usage?.total_cost??0);return Number.isFinite(n)&&n>0?n:0}
function canSpend(){return Number(budget.days[day].extractor_paid_usd||0)<PAID_CAP}
let apiCalls=0;
async function rawCall(model,body,{timeoutMs=50000}={}){
  if(!canSpend())throw Object.assign(new Error('PAID_CAP_REACHED'),{code:'PAID_CAP_REACHED'});
  const h=health(model),t=Date.now();h.last_used=new Date().toISOString();let retryOther=0;
  while(true){
    apiCalls++;budget.days[day].llm++;budget.days[day].extraction++;
    let r,text;
    try{r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${API_KEY}`,'Content-Type':'application/json','HTTP-Referer':'https://gearwatch-market-causal-memory-jandromanis-projects.vercel.app','X-Title':'GearWatch Extractor V2.4'},body:JSON.stringify({...body,model}),signal:AbortSignal.timeout(timeoutMs)});text=await r.text()}catch(e){h.fail++;h.last_error=String(e.message||e);throw e}
    if(r.ok){const response=JSON.parse(text),cost=costOf(response);if(cost)budget.days[day].extractor_paid_usd=+(Number(budget.days[day].extractor_paid_usd||0)+cost).toFixed(6);h.success++;h.total_ms+=Date.now()-t;h.last_success=new Date().toISOString();return {response,cost}}
    if(r.status===404)h.http404++;if(r.status===429)h.http429++;h.last_error=`${r.status}:${text.slice(0,180)}`;
    if(r.status>=500&&retryOther<(policy.scheduler?.max_retry_other??1)){retryOther++;await sleep(700);continue}
    h.fail++;throw Object.assign(new Error(`OpenRouter ${r.status}: ${text.slice(0,300)}`),{status:r.status})
  }
}
function decodeContent(content){const p=parseModelJson(content);if(!p.value)return {parsed:null,error:p.error,raw:p.raw};const parsed=normalizeParsed(p.value);return validParsed(parsed)?{parsed,error:null,raw:p.raw}:{parsed:null,error:new Error('JSON_SCHEMA_CONTRACT_INVALID'),raw:p.raw}}
async function repairBroken(model,raw){
  const h=health(model);h.repairs++;
  const prompt=`SCHEMA:\n${JSON.stringify(schema)}\nBROKEN RESPONSE:\n${String(raw||'').slice(0,14000)}\nRepair syntax and normalize field names only. Do not introduce new claims.`;
  const {response,cost}=await rawCall(model,{temperature:0,max_tokens:1300,messages:[{role:'system',content:REPAIR_SYSTEM},{role:'user',content:prompt}],provider:{require_parameters:true},response_format:{type:'json_schema',json_schema:{name:'gearwatch_repair',strict:true,schema}}},{timeoutMs:45000});
  const decoded=decodeContent(response.choices?.[0]?.message?.content||'');if(!decoded.parsed)throw decoded.error||new Error('REPAIR_FAILED');return {response,parsed:decoded.parsed,cost};
}
async function callModel(model,messages){
  const h=health(model);const {response,cost}=await rawCall(model,{temperature:0,max_tokens:1300,messages,provider:{require_parameters:true},response_format:{type:'json_schema',json_schema:{name:'gearwatch_extraction',strict:true,schema}}});
  const content=response.choices?.[0]?.message?.content||'';const decoded=decodeContent(content);
  if(decoded.parsed)return {response,parsed:decoded.parsed,requested_model:model,format_mode:'json_schema',cost,repaired:false};
  h.schema_fail++;if(decoded.error?.name==='SyntaxError')h.parse_fail++;
  if(MAX_REPAIRS>0){const fixed=await repairBroken(model,decoded.raw||content);return {response:fixed.response,parsed:fixed.parsed,requested_model:model,format_mode:'json_schema+repair',cost:cost+fixed.cost,repaired:true}}
  throw decoded.error||new Error('JSON_SCHEMA_CONTRACT_INVALID');
}
async function callWithFallback(messages){
  const failures=[];
  for(const model of [...new Set([PRIMARY,FALLBACK])]){
    try{return await callModel(model,messages)}catch(e){failures.push(`${model}: ${String(e.message||e).slice(0,260)}`);if(e.code==='PAID_CAP_REACHED')break}
  }
  throw new Error(`MODEL_CHAIN_EXHAUSTED | ${failures.join(' | ').slice(0,1200)}`)
}
function promptFor(m,bucket){const candidates=(bucket.candidates||[]).slice(0,20).map(c=>({id:c.id,phase:c.phase,signal:c.signal,title:c.title,source:c.source_name,domain:c.domain,published_at:c.published_at,url:c.url,snippet:String(c.snippet||'').slice(0,500),official:Boolean(c.official),source_grade:c.source_grade??null,engine:c.engine}));const prev=previous.mechanisms?.[m.id];return `UTC NOW: ${now.toISOString()}\nMECHANISM: ${m.id} — ${m.label}\nFOCUS: ${m.prompt_focus}\nPREVIOUS: ${prev?JSON.stringify({state:prev.state,score:prev.score,last_run:prev.last_run}):'none'}\nCANDIDATES:\n${JSON.stringify(candidates)}\nExtract only material evidence. Prefer official=true candidates when they actually support the mechanism. Preserve contradictions.`}
function priority(m){const prev=previous.mechanisms?.[m.id];const state={ACTIVE:80,ARMING:65,WATCH:40,SATURATED:20,INVALIDATED:5,STALE:55,UNKNOWN:25,DORMANT:15}[prev?.state]||20,tier={A:70,B:35,C:10}[m.tier]||0,alpha=prev?.alpha?.eligible?45:0,last=Date.parse(prev?.last_run||''),unseen=Number.isFinite(last)?0:110,age=Number.isFinite(last)?Math.min(80,(Date.now()-last)/36e5*2):0;return tier+state+alpha+unseen+age}
function slotsLeft(){const hours=policy.scheduler?.utc_hours||[0,6,12,18],h=now.getUTCHours();return Math.max(1,hours.filter(x=>x>=h).length)}
const extractionDailyCap=Math.max(1,Number(quota.extraction_daily_cap||46)),remainingDaily=Math.max(0,extractionDailyCap-(budget.days[day].extraction||0)),runCap=Math.min(policy.budgets?.max_llm_requests_per_run||26,Math.ceil(remainingDaily/slotsLeft()));
const candidates=mechCfg.mechanisms.filter(m=>retrieval.mechanisms?.[m.id]).sort((a,b)=>priority(b)-priority(a)||a.id.localeCompare(b.id)),chosen=candidates.slice(0,runCap);
const results={version:'2.4.0',run_id:retrieval.run_id,generated_at:now.toISOString(),model_chain:[PRIMARY,FALLBACK],concurrency:CONCURRENCY,repair_policy:{local_syntax_repair:true,llm_repair_attempts:MAX_REPAIRS,response_healing_account_plugin:'recommended'},quota:{extraction_daily_cap:extractionDailyCap,remaining_before:remainingDaily,run_cap:runCap,selected:candidates.length,paid_cap_usd:PAID_CAP,paid_before_usd:Number(budget.days[day].extractor_paid_usd||0)},mechanisms:{},errors:[],deferred:candidates.slice(runCap).map(m=>({mechanism_id:m.id,reason:'QUOTA_ROTATION',priority:+priority(m).toFixed(1)}))};
async function extractOne(m){
  const bucket=retrieval.mechanisms?.[m.id];if(!bucket)return;
  if(!(bucket.candidates||[]).length){results.mechanisms[m.id]={id:m.id,label:m.label,tier:m.tier,summary:'No fresh deterministic candidates in this cycle.',evidence:[],expected_next:[],invalidation:[],model:null,usage:null,candidate_count:0,query_trace:bucket.queries||[]};return}
  const allowed=new Map((bucket.candidates||[]).map(c=>[c.id,c]));
  try{
    const {response,parsed,requested_model,format_mode,cost,repaired}=await callWithFallback([{role:'system',content:SYSTEM},{role:'user',content:promptFor(m,bucket)}]);const evidence=[];
    for(const item of parsed.items||[]){const c=allowed.get(item.candidate_id);if(!c||item.relevance<.55)continue;const source_grade=Math.max(Number(c.source_grade||0),gradeDomain(c.domain||domainOf(c.url)));evidence.push({candidate_id:c.id,query_id:c.query_id,phase:c.phase,signal:c.signal,family:c.official?'OFFICIAL':c.phase==='LEAD'?'PHYSICAL':c.phase==='CONFIRM'?'PRICE':'CORPORATE',fact_type:item.fact_type,claim:item.claim,direction:item.direction,relevance:item.relevance,contradiction:item.contradiction,why_upstream:item.why_upstream,source_url:c.url,source_name:c.source_name,source_domain:c.domain||domainOf(c.url),source_grade,official:Boolean(c.official),engine:c.engine||null,published_at:c.published_at,retrieved_at:c.retrieved_at,valid:item.fact_type==='FACT'&&Boolean(c.url)})}
    results.mechanisms[m.id]={id:m.id,label:m.label,tier:m.tier,summary:parsed.summary,evidence,expected_next:parsed.expected_next,invalidation:parsed.invalidation,model:response.model,requested_model,format_mode,repaired,cost_usd:+Number(cost||0).toFixed(6),usage:response.usage||null,candidate_count:bucket.candidates?.length||0,official_candidate_count:(bucket.candidates||[]).filter(c=>c.official).length,query_trace:bucket.queries||[]};
  }catch(e){results.errors.push({mechanism_id:m.id,error:String(e.message||e)})}
}
await mapConcurrent(chosen,CONCURRENCY,extractOne);
for(const d of Object.keys(budget.days))if(d<new Date(Date.now()-10*864e5).toISOString().slice(0,10))delete budget.days[d];
results.quota.paid_after_usd=Number(budget.days[day].extractor_paid_usd||0);results.api_calls=apiCalls;
await fs.mkdir('data/extraction',{recursive:true});await fs.writeFile('data/extraction/latest.json',JSON.stringify(results,null,2)+'\n');await fs.writeFile(`data/extraction/${retrieval.run_id}.json`,JSON.stringify(results,null,2)+'\n');await fs.writeFile(budgetPath,JSON.stringify(budget,null,2)+'\n');await fs.writeFile(healthPath,JSON.stringify(modelHealth,null,2)+'\n');console.log(`extraction ${retrieval.run_id}: mechanisms=${Object.keys(results.mechanisms).length}/${chosen.length}, api_calls=${apiCalls}, errors=${results.errors.length}, concurrency=${CONCURRENCY}, paid=$${Number(budget.days[day].extractor_paid_usd||0).toFixed(4)}/$${PAID_CAP}`);
