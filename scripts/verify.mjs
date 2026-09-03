import fs from 'node:fs/promises';
import {causalScore} from './score.v2.mjs';

const API_KEY=process.env.OPENROUTER_API_KEY;if(!API_KEY){console.error('OPENROUTER_API_KEY missing');process.exit(2)}
const policy=JSON.parse(await fs.readFile('config/policy.v2.json','utf8'));
const extraction=JSON.parse(await fs.readFile('data/extraction/latest.json','utf8'));
const previous=JSON.parse(await fs.readFile('data/current.json','utf8').catch(()=>'{"mechanisms":{}}'));
const budgetPath='data/budget.json';const budget=JSON.parse(await fs.readFile(budgetPath,'utf8').catch(()=>'{"days":{}}'));
const now=new Date(),day=now.toISOString().slice(0,10);budget.days[day]??={llm:0,web:0};
const MODEL=process.env.OPENROUTER_MODEL||policy.model||'openai/gpt-oss-120b:free';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const domainOf=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''}};
const gradeDomain=d=>{d=String(d||'').toLowerCase();if(d.endsWith('.gov')||d.endsWith('.mil')||d.endsWith('.int')||['federalreserve.gov','ecb.europa.eu','boj.or.jp','opec.org','iea.org','eia.gov','sec.gov','nato.int'].some(x=>d===x||d.endsWith('.'+x)))return 1;if(['reuters.com','bloomberg.com','ft.com','apnews.com','wsj.com'].some(x=>d===x||d.endsWith('.'+x)))return .92;return .7};
const annotations=msg=>{const urls=[];for(const a of msg?.annotations||[]){const u=a?.url_citation?.url||a?.url||a?.citation?.url;if(u)urls.push(u)}return [...new Set(urls)]};

const candidates=Object.values(extraction.mechanisms||{}).map(x=>({x,pre:causalScore(x.evidence||[]),prev:previous.mechanisms?.[x.id]})).filter(o=>o.pre.score>=48&&(o.pre.counts.LEAD>=1||o.pre.counts.CONFIRM>=1)).sort((a,b)=>((b.pre.score-(b.prev?.score||0))*2+b.pre.score)-((a.pre.score-(a.prev?.score||0))*2+a.pre.score));
const maxRun=policy.budgets?.max_web_verifiers_per_run||4;const chosen=candidates.slice(0,maxRun);
const schema={type:'object',additionalProperties:false,properties:{verdict:{type:'string',enum:['CONFIRMED','MIXED','CONTRADICTED','INSUFFICIENT']},summary:{type:'string'},claims:{type:'array',items:{type:'object',additionalProperties:false,properties:{claim:{type:'string'},source_url:{type:'string'},source_name:{type:'string'},contradiction:{type:'boolean'},material:{type:'boolean'}},required:['claim','source_url','source_name','contradiction','material']}},next_check:{type:'string'}},required:['verdict','summary','claims','next_check']};

async function call(o){
  const evidence=(o.x.evidence||[]).filter(e=>e.valid).slice(0,8).map(e=>({phase:e.phase,signal:e.signal,claim:e.claim,source:e.source_url}));
  const prompt=`UTC ${now.toISOString()}\nMECHANISM ${o.x.id} — ${o.x.label}\nPRELIMINARY CAUSAL SCORE ${o.pre.score}\nEARLY CLAIMS ${JSON.stringify(evidence)}\n\nSearch the current web for INDEPENDENT evidence that verifies or contradicts these exact upstream claims. Do not discuss stock prices. Prefer official/government/company-primary sources, then Reuters/Bloomberg/FT/AP. Return only claims materially relevant to whether the mechanism is physically/economically real.`;
  const body={model:MODEL,temperature:0,max_tokens:1200,messages:[{role:'system',content:'You are GearWatch verification layer. Verify, contradict or reject early causal evidence. You do not decide mechanism state. Strict JSON only.'},{role:'user',content:prompt}],plugins:[{id:'web',engine:policy.web_verifier?.engine||'parallel',mode:policy.web_verifier?.mode||'turbo',max_results:policy.budgets?.max_web_results||8}],response_format:{type:'json_schema',json_schema:{name:'gearwatch_verification',strict:true,schema}}};
  let retried=false;
  while(true){
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${API_KEY}`,'Content-Type':'application/json','HTTP-Referer':'https://gearwatch-market-causal-memory-jandromanis-projects.vercel.app','X-Title':'GearWatch V2 Verifier'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const text=await r.text();
    if(r.ok){const response=JSON.parse(text),msg=response.choices?.[0]?.message,parsed=JSON.parse(msg?.content||'{}'),grounded=annotations(msg);return {response,parsed,grounded}}
    if(r.status===429&&!retried){retried=true;await sleep(Math.min(60000,Number(r.headers.get('retry-after')||20)*1000));continue}
    throw new Error(`OpenRouter ${r.status}: ${text.slice(0,300)}`);
  }
}

const out={version:'2.0.0',run_id:extraction.run_id,generated_at:now.toISOString(),mechanisms:{},errors:[]};let used=0;
for(const o of chosen){
  if(budget.days[day].web>=(policy.budgets?.max_web_verifiers_per_day||12)||budget.days[day].llm>=(policy.budgets?.max_llm_requests_per_day||140))break;
  try{
    const {response,parsed,grounded}=await call(o);used++;budget.days[day].web++;budget.days[day].llm++;
    const verified=(parsed.claims||[]).map(c=>{const ok=grounded.includes(c.source_url);return {...c,source_domain:domainOf(c.source_url),source_grade:gradeDomain(domainOf(c.source_url)),valid:ok&&c.material,grounded:ok}}).filter(c=>c.valid);
    out.mechanisms[o.x.id]={id:o.x.id,verdict:parsed.verdict,summary:parsed.summary,next_check:parsed.next_check,verified,grounded_urls:grounded,model:response.model,usage:response.usage||null};
  }catch(e){out.errors.push({mechanism_id:o.x.id,error:String(e.message||e)})}
  await sleep(policy.scheduler?.inter_request_ms||3400);
}
await fs.mkdir('data/verification',{recursive:true});await fs.writeFile('data/verification/latest.json',JSON.stringify(out,null,2)+'\n');await fs.writeFile(`data/verification/${extraction.run_id}.json`,JSON.stringify(out,null,2)+'\n');await fs.writeFile(budgetPath,JSON.stringify(budget,null,2)+'\n');
console.log(`verification ${extraction.run_id}: ${used} web verifiers, ${out.errors.length} errors`);
