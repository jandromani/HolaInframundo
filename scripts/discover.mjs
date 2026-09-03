import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const API_KEY=process.env.OPENROUTER_API_KEY;if(!API_KEY){console.error('OPENROUTER_API_KEY missing');process.exit(2)}
const policy=JSON.parse(await fs.readFile('config/policy.v2.json','utf8'));
const quota=JSON.parse(await fs.readFile('data/openrouter-quota.json','utf8').catch(()=>'{"discovery_daily_reserve":8,"safe_daily_requests":50}'));
const retrievalPath='data/retrieval/latest.json',retrieval=JSON.parse(await fs.readFile(retrievalPath,'utf8'));
const mechCfg=JSON.parse(await fs.readFile('config/mechanisms.json','utf8'));
const previous=JSON.parse(await fs.readFile('data/current.json','utf8').catch(()=>'{"mechanisms":{}}'));
const budgetPath='data/budget.json',budget=JSON.parse(await fs.readFile(budgetPath,'utf8').catch(()=>'{"days":{}}'));
const now=new Date(),day=now.toISOString().slice(0,10);budget.days[day]??={llm:0,web:0,extraction:0,verifier:0,discovery:0,paid_usd:0};budget.days[day].discovery??=0;budget.days[day].paid_usd??=0;
const maxRun=policy.budgets?.max_fallback_searches_per_run||6,dailyReserve=Number(quota.discovery_daily_reserve||8),remaining=Math.max(0,dailyReserve-budget.days[day].discovery),runCap=Math.min(maxRun,remaining);
const MODEL='openrouter/free',hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,20),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const annotations=msg=>{const out=[];for(const a of msg?.annotations||[]){const c=a?.url_citation||a?.citation||a;if(c?.url)out.push({url:c.url,title:c.title||'',content:c.content||c.snippet||''})}return out};
function priority(m){const p=previous.mechanisms?.[m.id];return ({A:100,B:55,C:20}[m.tier]||0)+({ACTIVE:90,ARMING:75,WATCH:50,STALE:65,UNKNOWN:35,DORMANT:15}[p?.state]||30)+(p?.alpha?.eligible?50:0)}
const need=mechCfg.mechanisms.map(m=>({m,b:retrieval.mechanisms?.[m.id]})).filter(x=>x.b&&(x.b.candidates||[]).length<(policy.retrieval?.fallback_when_candidates_below||2)).sort((a,b)=>priority(b.m)-priority(a.m));
const chosen=need.slice(0,runCap);const trace={version:'2.2.0',run_id:retrieval.run_id,generated_at:now.toISOString(),model:MODEL,candidates:need.length,selected:chosen.map(x=>x.m.id),searches:[],errors:[]};
for(const {m,b} of chosen){
  const q=(b.queries||[]).find(x=>x.phase==='LEAD')||(b.queries||[])[0];if(!q)continue;
  const prompt=`Search the live web for this EXACT market-intelligence lead topic: ${q.q}\nMechanism: ${m.label}. Focus on events from the last 48 hours. Prefer official/company/regulatory sources, Reuters/Bloomberg/FT/AP and specialist physical-market sources. This is discovery only: return a short factual summary with citations; do not recommend stocks.`;
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${API_KEY}`,'Content-Type':'application/json','HTTP-Referer':'https://gearwatch-market-causal-memory-jandromanis-projects.vercel.app','X-Title':'GearWatch Sparse Discovery'},body:JSON.stringify({model:MODEL,temperature:0,max_tokens:600,messages:[{role:'user',content:prompt}],plugins:[{id:'web',engine:policy.web_verifier?.engine||'parallel',mode:policy.web_verifier?.mode||'turbo',max_results:6}]}),signal:AbortSignal.timeout(90000)}),text=await r.text();
    if(!r.ok)throw new Error(`OpenRouter ${r.status}: ${text.slice(0,250)}`);const response=JSON.parse(text),msg=response.choices?.[0]?.message,anns=annotations(msg);budget.days[day].llm++;budget.days[day].web++;budget.days[day].discovery++;const cost=Number(response.usage?.cost??response.usage?.total_cost??0);if(Number.isFinite(cost)&&cost>0)budget.days[day].paid_usd=+(budget.days[day].paid_usd+cost).toFixed(6);
    let added=0;for(const a of anns){if(!a.url)continue;const key=a.url.toLowerCase().replace(/[?#].*$/,'');if((b.candidates||[]).some(x=>(x.url||'').toLowerCase().replace(/[?#].*$/,'')===key))continue;b.candidates.push({id:hash(`${q.query_id}|${a.url}|${a.title}`),mechanism_id:m.id,query_id:q.query_id,phase:q.phase,signal:q.signal,query:q.q,engine:'openrouter_web_fallback',title:a.title||a.content?.slice(0,140)||'Web discovery',url:a.url,domain:(()=>{try{return new URL(a.url).hostname.replace(/^www\./,'')}catch{return ''}})(),source_name:a.title||'web',published_at:now.toISOString(),snippet:a.content||'',retrieved_at:now.toISOString(),fallback:true});added++}
    trace.searches.push({mechanism_id:m.id,query_id:q.query_id,q:q.q,annotations:anns.length,added,actual_model:response.model,usage:response.usage||null});
  }catch(e){trace.errors.push({mechanism_id:m.id,error:String(e.message||e)})}
  await sleep(policy.scheduler?.inter_request_ms||3200);
}
for(const b of Object.values(retrieval.mechanisms||{}))b.candidates=(b.candidates||[]).slice(0,36);
retrieval.discovery_fallback={run_cap:runCap,needed:need.length,used:trace.searches.length,errors:trace.errors.length,generated_at:now.toISOString()};
await fs.writeFile(retrievalPath,JSON.stringify(retrieval,null,2)+'\n');await fs.mkdir('data/discovery',{recursive:true});await fs.writeFile('data/discovery/latest.json',JSON.stringify(trace,null,2)+'\n');await fs.writeFile(`data/discovery/${retrieval.run_id}.json`,JSON.stringify(trace,null,2)+'\n');await fs.writeFile(budgetPath,JSON.stringify(budget,null,2)+'\n');console.log(`discovery fallback: ${trace.searches.length}/${runCap} searches, ${trace.searches.reduce((a,x)=>a+x.added,0)} candidates added, errors=${trace.errors.length}`);
