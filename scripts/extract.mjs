import fs from 'node:fs/promises';

const API_KEY=process.env.OPENROUTER_API_KEY;
if(!API_KEY){console.error('OPENROUTER_API_KEY missing');process.exit(2)}
const policy=JSON.parse(await fs.readFile('config/policy.v2.json','utf8'));
const mechCfg=JSON.parse(await fs.readFile('config/mechanisms.json','utf8'));
const retrieval=JSON.parse(await fs.readFile('data/retrieval/latest.json','utf8'));
const previous=JSON.parse(await fs.readFile('data/current.json','utf8').catch(()=>'{"mechanisms":{}}'));
const quota=JSON.parse(await fs.readFile('data/openrouter-quota.json','utf8').catch(()=>'{"extraction_daily_cap":46}'));
const now=new Date();
const MODEL=process.env.OPENROUTER_MODEL||policy.model||'openai/gpt-oss-120b:free';
const budgetPath='data/budget.json';
const budget=JSON.parse(await fs.readFile(budgetPath,'utf8').catch(()=>'{"days":{}}'));
const day=now.toISOString().slice(0,10);
budget.days[day]??={llm:0,web:0,extraction:0,verifier:0};
budget.days[day].extraction??=Math.max(0,(budget.days[day].llm||0)-(budget.days[day].verifier||0));
budget.days[day].verifier??=budget.days[day].web||0;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const domainOf=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''}};
const gradeDomain=d=>{
  d=String(d||'').toLowerCase();
  if(!d)return 0.45;
  if(d.endsWith('.gov')||d.endsWith('.mil')||d.endsWith('.int')||['federalreserve.gov','ecb.europa.eu','boj.or.jp','opec.org','iea.org','eia.gov','sec.gov','nato.int'].some(x=>d===x||d.endsWith('.'+x)))return 1;
  if(['reuters.com','bloomberg.com','ft.com','apnews.com','wsj.com'].some(x=>d===x||d.endsWith('.'+x)))return .92;
  if(['spglobal.com','argusmedia.com','tradewindsnews.com','lloydslist.com','offshore-energy.biz','defensenews.com','breakingdefense.com'].some(x=>d===x||d.endsWith('.'+x)))return .82;
  return .62;
};

const SYSTEM=`You are the extraction layer of GearWatch V2. You do not browse and you do not decide whether a market mechanism is active. You receive a deterministic set of fresh search results produced by exact versioned queries. Select only claims supported by the supplied candidates. Never invent a URL, number, date, source or causal conclusion. Prefer upstream evidence over headlines. LEAD means an early precursor; CONFIRM means the physical/economic variable that should move if the mechanism is real; LAG means earnings/headline confirmation that may arrive too late for alpha. If evidence is ambiguous, omit it. Return strict JSON only.`;
const schema={type:'object',additionalProperties:false,properties:{summary:{type:'string'},items:{type:'array',items:{type:'object',additionalProperties:false,properties:{candidate_id:{type:'string'},fact_type:{type:'string',enum:['FACT','INFERENCE']},claim:{type:'string'},direction:{type:'string',enum:['UP','DOWN','FLAT','MIXED','UNKNOWN']},relevance:{type:'number',minimum:0,maximum:1},contradiction:{type:'boolean'},why_upstream:{type:'string'}},required:['candidate_id','fact_type','claim','direction','relevance','contradiction','why_upstream']}},expected_next:{type:'array',items:{type:'string'}},invalidation:{type:'array',items:{type:'string'}}},required:['summary','items','expected_next','invalidation']};

async function openrouter(body){
  const max429=policy.scheduler?.max_retry_429??1;let retry429=0,retryOther=0;
  while(true){
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${API_KEY}`,'Content-Type':'application/json','HTTP-Referer':'https://gearwatch-market-causal-memory-jandromanis-projects.vercel.app','X-Title':'GearWatch V2'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
    const text=await r.text();
    if(r.ok)return JSON.parse(text);
    if(r.status===429&&retry429<max429){retry429++;const wait=Math.min(60000,Number(r.headers.get('retry-after')||20)*1000+Math.random()*1500);await sleep(wait);continue}
    if(r.status>=500&&retryOther<(policy.scheduler?.max_retry_other??1)){retryOther++;await sleep(3000+Math.random()*2000);continue}
    throw new Error(`OpenRouter ${r.status}: ${text.slice(0,400)}`);
  }
}

function promptFor(m,bucket){
  const candidates=(bucket.candidates||[]).slice(0,28).map(c=>({id:c.id,phase:c.phase,signal:c.signal,title:c.title,source:c.source_name,domain:c.domain,published_at:c.published_at,url:c.url,snippet:c.snippet}));
  const prev=previous.mechanisms?.[m.id];
  return `UTC NOW: ${now.toISOString()}\nMECHANISM: ${m.id} — ${m.label}\nFOCUS: ${m.prompt_focus}\nPREVIOUS: ${prev?JSON.stringify({state:prev.state,score:prev.score,market:prev.market,alpha:prev.alpha,last_run:prev.last_run}):'none'}\n\nDETERMINISTIC CANDIDATES:\n${JSON.stringify(candidates)}\n\nExtract only material evidence for this mechanism. candidate_id MUST be one of the supplied IDs. Do not repeat weak duplicates. Preserve contradictions.`;
}

function priority(m){
  const prev=previous.mechanisms?.[m.id];
  const state={ACTIVE:80,ARMING:65,WATCH:40,SATURATED:20,INVALIDATED:5,STALE:55,UNKNOWN:25,DORMANT:15}[prev?.state]||20;
  const tier={A:70,B:35,C:10}[m.tier]||0;
  const alpha=prev?.alpha?.eligible?45:0;
  const last=Date.parse(prev?.last_run||'');
  const unseen=Number.isFinite(last)?0:110;
  const age=Number.isFinite(last)?Math.min(80,(Date.now()-last)/36e5*2):0;
  return tier+state+alpha+unseen+age;
}
function slotsLeft(){
  const hours=policy.scheduler?.utc_hours||[0,6,12,18],h=now.getUTCHours();
  const future=hours.filter(x=>x>=h).length;return Math.max(1,future);
}

const extractionDailyCap=Math.max(1,Number(quota.extraction_daily_cap||46));
const remainingDaily=Math.max(0,extractionDailyCap-(budget.days[day].extraction||0));
const runCap=Math.min(policy.budgets?.max_llm_requests_per_run||26,Math.ceil(remainingDaily/slotsLeft()));
const candidates=mechCfg.mechanisms.filter(m=>retrieval.mechanisms?.[m.id]).sort((a,b)=>priority(b)-priority(a)||a.id.localeCompare(b.id));
const chosen=new Set(candidates.slice(0,runCap).map(m=>m.id));
const results={version:'2.0.0',run_id:retrieval.run_id,generated_at:now.toISOString(),model_requested:MODEL,quota:{extraction_daily_cap:extractionDailyCap,remaining_before:remainingDaily,run_cap:runCap,selected:candidates.length},mechanisms:{},errors:[],deferred:[]};
let runRequests=0;

for(const m of candidates){
  const bucket=retrieval.mechanisms?.[m.id];
  if(!chosen.has(m.id)){results.deferred.push({mechanism_id:m.id,reason:'QUOTA_ROTATION',priority:+priority(m).toFixed(1)});continue}
  if(!(bucket.candidates||[]).length){
    results.mechanisms[m.id]={id:m.id,label:m.label,tier:m.tier,summary:'No fresh deterministic candidates in this cycle.',evidence:[],expected_next:[],invalidation:[],model:null,usage:null,candidate_count:0,query_trace:bucket.queries||[]};continue;
  }
  if((budget.days[day].extraction||0)>=extractionDailyCap){results.deferred.push({mechanism_id:m.id,reason:'DAILY_EXTRACTION_CAP'});continue}
  const allowed=new Map((bucket.candidates||[]).map(c=>[c.id,c]));
  try{
    const response=await openrouter({model:MODEL,temperature:0,max_tokens:1800,messages:[{role:'system',content:SYSTEM},{role:'user',content:promptFor(m,bucket)}],response_format:{type:'json_schema',json_schema:{name:'gearwatch_extraction',strict:true,schema}}});
    runRequests++;budget.days[day].llm++;budget.days[day].extraction++;
    const msg=response.choices?.[0]?.message?.content||'{}';const parsed=JSON.parse(msg);const evidence=[];
    for(const item of parsed.items||[]){
      const c=allowed.get(item.candidate_id);if(!c||item.relevance<.55)continue;
      const source_grade=gradeDomain(c.domain||domainOf(c.url));
      evidence.push({candidate_id:c.id,query_id:c.query_id,phase:c.phase,signal:c.signal,family:c.phase==='LEAD'?'PHYSICAL':c.phase==='CONFIRM'?'PRICE':'CORPORATE',fact_type:item.fact_type,claim:item.claim,direction:item.direction,relevance:item.relevance,contradiction:item.contradiction,why_upstream:item.why_upstream,source_url:c.url,source_name:c.source_name,source_domain:c.domain||domainOf(c.url),source_grade,published_at:c.published_at,retrieved_at:c.retrieved_at,valid:item.fact_type==='FACT'&&Boolean(c.url)});
    }
    results.mechanisms[m.id]={id:m.id,label:m.label,tier:m.tier,summary:parsed.summary,evidence,expected_next:parsed.expected_next,invalidation:parsed.invalidation,model:response.model,usage:response.usage||null,candidate_count:bucket.candidates?.length||0,query_trace:bucket.queries||[]};
  }catch(e){results.errors.push({mechanism_id:m.id,error:String(e.message||e)})}
  await sleep(policy.scheduler?.inter_request_ms||3400);
}

for(const d of Object.keys(budget.days))if(d<new Date(Date.now()-10*864e5).toISOString().slice(0,10))delete budget.days[d];
await fs.mkdir('data/extraction',{recursive:true});
await fs.writeFile('data/extraction/latest.json',JSON.stringify(results,null,2)+'\n');
await fs.writeFile(`data/extraction/${retrieval.run_id}.json`,JSON.stringify(results,null,2)+'\n');
await fs.writeFile(budgetPath,JSON.stringify(budget,null,2)+'\n');
console.log(`extraction ${retrieval.run_id}: ${Object.keys(results.mechanisms).length} mechanisms, calls=${runRequests}, cap=${runCap}, deferred=${results.deferred.length}, errors=${results.errors.length}`);
