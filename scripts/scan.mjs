import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {evidenceScore,stateFromScore,marketConfirmation,alphaClick} from './score.mjs';

const API_KEY=process.env.OPENROUTER_API_KEY;
if(!API_KEY){console.error('OPENROUTER_API_KEY missing'); process.exit(2);}
const MODEL=process.env.OPENROUTER_MODEL||'openai/gpt-oss-20b:free';
const cfg=JSON.parse(await fs.readFile('config/mechanisms.json','utf8'));
const market=JSON.parse(await fs.readFile('data/market.json','utf8').catch(()=>'{"metrics":{}}'));
const previous=JSON.parse(await fs.readFile('data/current.json','utf8').catch(()=>'{"mechanisms":{}}'));
const now=new Date(); const hour=now.getUTCHours();
const shouldRun=m=>m.tier==='A'||(m.tier==='B'&&hour%12===0)||(m.tier==='C'&&hour===0);
const selected=cfg.mechanisms.filter(shouldRun);
const runId=`run_${now.toISOString().replace(/[:.]/g,'-')}`;

const SYSTEM=`You are an evidence-extraction sensor for a causal market intelligence system.\n\nYou are NOT a stock picker and NOT an alarm generator. The code, not you, decides mechanism state.\n\nSearch the current web and return only fresh, source-grounded evidence. Prefer official data, regulators, central banks, company filings, Reuters, Bloomberg, FT, AP and specialist physical-market sources. Social media can only identify a lead, never confirm one.\n\nLook UPSTREAM of mainstream headlines: physical flows, tenders, RFQs, procurement changes, customs, inventories, route deviations, lead times, plant utilization, contract quantities, utility filings and actual paid orders.\n\nClassify every evidence item into PHYSICAL, PRICE, CORPORATE or POLICY. Separate FACT from INFERENCE. Include contradictions. Never convert missing data into a negative fact. If there is no material fresh evidence, return an empty evidence array. Source URLs must correspond to sources actually returned by web grounding. No prose outside JSON.`;

const schema={
  type:'object',additionalProperties:false,
  properties:{
    summary:{type:'string'}, material_change:{type:'boolean'},
    evidence:{type:'array',items:{type:'object',additionalProperties:false,properties:{
      family:{type:'string',enum:['PHYSICAL','PRICE','CORPORATE','POLICY']},
      fact_type:{type:'string',enum:['FACT','INFERENCE']}, claim:{type:'string'},
      source_url:{type:'string'}, source_name:{type:'string'}, observed_at:{type:'string'},
      fresh_hours:{type:['number','null']}, quality:{type:'number',minimum:0,maximum:1},
      direction:{type:'string',enum:['UP','DOWN','FLAT','MIXED','UNKNOWN']}, contradiction:{type:'boolean'}
    },required:['family','fact_type','claim','source_url','source_name','observed_at','fresh_hours','quality','direction','contradiction']}},
    expected_next:{type:'array',items:{type:'string'}}, invalidation:{type:'array',items:{type:'string'}},
    search_notes:{type:'array',items:{type:'string'}}
  },required:['summary','material_change','evidence','expected_next','invalidation','search_notes']
};

function promptFor(m){
  const prev=previous.mechanisms?.[m.id];
  return `CURRENT UTC: ${now.toISOString()}\nMECHANISM: ${m.id} — ${m.label}\n\nFOCUS:\n${m.prompt_focus}\n\nUPSTREAM SENSORS:\n${m.leading_sensors.join('; ')}\n\nSEARCH KEYWORDS / CONCEPTS:\n${m.keywords.join('; ')}\n\nPREVIOUS MEMORY:\n${prev?JSON.stringify({state:prev.state,score:prev.score,summary:prev.summary,expected_next:prev.expected_next,last_run:prev.last_run}):'No prior state'}\n\nFind what changed since the previous memory. Do not repeat old facts unless newly confirmed or contradicted.`;
}

function annotations(message){
  const urls=new Set();
  for(const a of message?.annotations||[]){
    const u=a?.url_citation?.url||a?.url||a?.citation?.url;
    if(u) urls.add(u);
  }
  return urls;
}

async function call(m){
  const body={
    model:MODEL, temperature:0, max_tokens:2200,
    messages:[{role:'system',content:SYSTEM},{role:'user',content:promptFor(m)}],
    plugins:[{id:'web',engine:'exa',max_results:6}],
    response_format:{type:'json_schema',json_schema:{name:'mechanism_evidence',strict:true,schema}}
  };
  const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${API_KEY}`,'Content-Type':'application/json','HTTP-Referer':'https://gearwatch-market-causal-memory-jandromanis-projects.vercel.app','X-Title':'GearWatch'},body:JSON.stringify(body)});
  const raw=await r.text();
  if(!r.ok) throw new Error(`OpenRouter ${r.status}: ${raw.slice(0,500)}`);
  const response=JSON.parse(raw); const msg=response.choices?.[0]?.message;
  let parsed; try{parsed=JSON.parse(msg?.content||'{}');}catch{throw new Error('Invalid JSON model output');}
  const grounded=annotations(msg);
  parsed.evidence=(parsed.evidence||[]).map(e=>{
    const sourceVerified=!grounded.size||grounded.has(e.source_url);
    return {...e,source_verified:sourceVerified,valid:sourceVerified && e.fact_type==='FACT'};
  });
  return {parsed,response,grounded:[...grounded]};
}

const results=[]; const errors=[];
for(const m of selected){
  try{
    const {parsed,response,grounded}=await call(m);
    const evidence=parsed.evidence||[];
    const mkt=marketConfirmation((m.positive||[]).map(t=>market.metrics?.[t]).filter(Boolean));
    const score=evidenceScore(evidence);
    const sourceFamilies=new Set(evidence.filter(e=>e.valid).map(e=>e.family)).size;
    const sourceCount=new Set(evidence.filter(e=>e.valid).map(e=>e.source_url)).size;
    const invalidated=false;
    const state=stateFromScore(score,{unknown:evidence.length===0&&sourceCount===0,invalidated,crowding:mkt.crowding});
    const alpha=alphaClick({mechanismScore:score,marketScore:mkt.score,crowding:mkt.crowding,sourceFamilies,sourceCount,invalidated});
    const events=evidence.map(e=>({
      id:crypto.createHash('sha256').update(`${m.id}|${e.claim}|${e.source_url}`).digest('hex').slice(0,20),
      mechanism_id:m.id,run_id:runId,observed_at:e.observed_at,ingested_at:now.toISOString(),...e
    }));
    results.push({id:m.id,label:m.label,tier:m.tier,state,score,previous_state:previous.mechanisms?.[m.id]?.state||null,score_delta:score-(previous.mechanisms?.[m.id]?.score||0),summary:parsed.summary,material_change:parsed.material_change,evidence,events,expected_next:parsed.expected_next,invalidation:parsed.invalidation,market:mkt,alpha,positive:m.positive,negative:m.negative,last_run:now.toISOString(),model:response.model,usage:response.usage||null,grounded_urls:grounded});
  }catch(e){
    errors.push({mechanism_id:m.id,error:String(e.message||e)});
  }
  await new Promise(r=>setTimeout(r,3200));
}

const mechanisms={...(previous.mechanisms||{})};
for(const r of results) mechanisms[r.id]=r;
const current={version:cfg.version,updated_at:now.toISOString(),run_id:runId,health:{expected:selected.length,completed:results.length,failed:errors.length,errors},mechanisms};
const history={run_id:runId,started_at:now.toISOString(),model_requested:MODEL,selected:selected.map(x=>x.id),results,errors,market_asof:market.generated_at||null};

await fs.mkdir('data/history',{recursive:true});
await fs.writeFile('data/current.json',JSON.stringify(current,null,2)+'\n');
await fs.writeFile(`data/history/${runId}.json`,JSON.stringify(history,null,2)+'\n');
console.log(`scan ${runId}: ${results.length}/${selected.length} mechanisms complete`);
