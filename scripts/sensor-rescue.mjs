import fs from 'node:fs/promises';

const extractionPath='data/extraction/latest.json';
const retrievalPath='data/retrieval/latest.json';
const extraction=JSON.parse(await fs.readFile(extractionPath,'utf8'));
const retrieval=JSON.parse(await fs.readFile(retrievalPath,'utf8'));
const TARGET='COUNTER_UAS_COST_CURVE';
const out=extraction.mechanisms?.[TARGET];
const bucket=retrieval.mechanisms?.[TARGET];
if(!out||!bucket){console.log('sensor rescue: counter-UAS not present');process.exit(0)}
if((out.evidence||[]).length){console.log(`sensor rescue: counter-UAS already has ${out.evidence.length} evidence rows`);process.exit(0)}
const deny=/forecast|market size|will reach|opinion|analysis|explainer/i;
const allow=/counter[- ]?(?:uas|drone)|anti[- ]?drone|interceptor|drone swarm|electronic warfare|laser|low-cost air defense|low-cost air defence/i;
const domainOf=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''}};
const grade=d=>{d=String(d||'').toLowerCase();if(/\.gov$|\.mil$/.test(d)||d==='nato.int')return 1;if(['reuters.com','apnews.com','defensenews.com','breakingdefense.com'].some(x=>d===x||d.endsWith('.'+x)))return .9;return .62};
const seen=new Set();
const rows=[];
for(const c of bucket.candidates||[]){
 const title=String(c.title||'').trim(),snippet=String(c.snippet||'').trim(),text=`${title} ${snippet}`;
 if(!c.id||!c.url||!allow.test(text)||deny.test(title))continue;
 const domain=c.domain||domainOf(c.url),key=`${c.signal}|${domain}|${title.toLowerCase().replace(/[^a-z0-9]+/g,' ').slice(0,90)}`;
 if(seen.has(key))continue;seen.add(key);
 rows.push({candidate_id:c.id,query_id:c.query_id,phase:c.phase||'LEAD',signal:c.signal||'COUNTER_UAS_SIGNAL',family:c.official?'OFFICIAL':'PHYSICAL',fact_type:'FACT',claim:title,direction:'UP',relevance:.7,contradiction:false,why_upstream:'El candidato describe una prueba, despliegue, compra o reducción de coste en counter-UAS; es una señal previa a una adopción presupuestaria más amplia.',source_url:c.url,source_name:c.source_name||title,source_domain:domain,source_grade:Math.max(Number(c.source_grade||0),grade(domain)),official:Boolean(c.official),engine:c.engine||null,published_at:c.published_at||null,retrieved_at:c.retrieved_at||extraction.generated_at,valid:true,rescue:'DETERMINISTIC_TITLE_BOUND'});
 if(rows.length>=4)break;
}
if(!rows.length){console.log('sensor rescue: no conservative counter-UAS candidates survived');process.exit(0)}
out.summary='Deterministic rescue: retrieval found counter-UAS test/procurement candidates but the model extractor returned an empty evidence set. Source-bound candidate headlines were preserved so the causal scorer can evaluate them normally.';
out.evidence=rows;
out.expected_next=[...(out.expected_next||[]),'Look for procurement awards, operational trials and cost-per-intercept evidence that confirm counter-UAS economics at scale.'].slice(0,5);
out.rescue={applied:true,reason:'MODEL_EMPTY_WITH_RETRIEVAL_CANDIDATES',rows:rows.length,policy:'SOURCE_BOUND_NO_SCORE_OVERRIDE'};
await fs.writeFile(extractionPath,JSON.stringify(extraction,null,2)+'\n');
const runPath=`data/extraction/${extraction.run_id}.json`;
await fs.writeFile(runPath,JSON.stringify(extraction,null,2)+'\n').catch(()=>{});
console.log(`sensor rescue: counter-UAS restored ${rows.length} source-bound evidence rows; causal score remains deterministic downstream`);
