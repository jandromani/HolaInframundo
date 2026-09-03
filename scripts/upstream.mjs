import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const policy=JSON.parse(await fs.readFile('config/policy.v2.json','utf8'));
const sources=JSON.parse(await fs.readFile('config/sources.v2.json','utf8'));
const retrievalPath='data/retrieval/latest.json',retrieval=JSON.parse(await fs.readFile(retrievalPath,'utf8'));
const now=new Date(),windowHours=policy.retrieval?.official_upstream_window_hours||96,maxItems=policy.retrieval?.official_upstream_max_items_per_source||30;
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,20),domainOf=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''}};
const strip=s=>String(s||'').replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
const tag=(b,t)=>{const m=b.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`,'i'));return m?strip(m[1]):''};
const linkOf=b=>{const direct=tag(b,'link');if(direct)return direct;const m=b.match(/<link[^>]+href=["']([^"']+)["']/i);return m?.[1]||''};
const recent=ts=>{const t=Date.parse(ts||'');return !Number.isFinite(t)||((Date.now()-t)/36e5)<=windowHours};
async function get(url){const r=await fetch(url,{headers:{'user-agent':'GearWatch/2.3 official-source-monitor contact: research@example.invalid'},signal:AbortSignal.timeout(policy.retrieval?.source_timeout_ms||6500)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r}
function rssItems(xml){const rss=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(x=>x[1]),atom=[...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map(x=>x[1]);return [...rss,...atom].slice(0,maxItems).map(b=>({title:tag(b,'title'),url:linkOf(b),published_at:tag(b,'pubDate')||tag(b,'published')||tag(b,'updated'),snippet:tag(b,'description')||tag(b,'summary')||tag(b,'content')})).filter(x=>x.url||x.title)}
function relevant(item,terms=[]){const text=`${item.title} ${item.snippet}`.toLowerCase();return terms.some(t=>text.includes(String(t).toLowerCase()))}
function addCandidate(bucket,c){const key=(c.url||c.title).toLowerCase().replace(/[?#].*$/,'');if(!key)return false;if((bucket.candidates||[]).some(x=>(x.url||x.title||'').toLowerCase().replace(/[?#].*$/,'')===key))return false;bucket.candidates??=[];bucket.candidates.push(c);return true}

const trace={version:'2.3.0',run_id:retrieval.run_id,generated_at:now.toISOString(),rss:[],federal_register:[],added:0,errors:[]};
for(const src of sources.rss||[]){
  try{
    const r=await get(src.url),xml=await r.text(),items=rssItems(xml).filter(x=>recent(x.published_at));let added=0;
    for(const target of src.targets||[]){const bucket=retrieval.mechanisms?.[target.mechanism_id];if(!bucket)continue;for(const item of items){if(!relevant(item,target.terms||[]))continue;const qid=`OFFICIAL:${src.id}:${target.mechanism_id}:${target.signal}`;const c={id:hash(`${qid}|${item.url}|${item.title}`),mechanism_id:target.mechanism_id,query_id:qid,phase:target.phase,signal:target.signal,query:`official feed ${src.id}`,engine:'official_rss',title:item.title,url:item.url,domain:domainOf(item.url)||domainOf(src.url),source_name:src.name,published_at:item.published_at||now.toISOString(),snippet:item.snippet||'',retrieved_at:now.toISOString(),official:true,source_grade:src.grade??1};if(addCandidate(bucket,c)){added++;trace.added++}}}
    trace.rss.push({source:src.id,items:items.length,added});
  }catch(e){trace.errors.push({source:src.id,error:String(e.message||e)})}
}
for(const src of sources.federal_register||[]){
  const bucket=retrieval.mechanisms?.[src.mechanism_id];if(!bucket)continue;
  try{
    const url=`https://www.federalregister.gov/api/v1/documents.json?per_page=${Math.min(20,maxItems)}&order=newest&conditions%5Bterm%5D=${encodeURIComponent(src.term)}`;
    const r=await get(url),j=await r.json(),items=(j.results||[]).filter(x=>recent(x.publication_date));let added=0;
    for(const item of items){const u=item.html_url||item.raw_text_url||item.pdf_url||'';if(!u)continue;const qid=`OFFICIAL:${src.id}:${src.mechanism_id}`,c={id:hash(`${qid}|${u}|${item.title}`),mechanism_id:src.mechanism_id,query_id:qid,phase:src.phase,signal:src.signal,query:src.term,engine:'federal_register',title:item.title||'',url:u,domain:'federalregister.gov',source_name:'Federal Register',published_at:item.publication_date||now.toISOString(),snippet:item.abstract||item.excerpts||'',retrieved_at:now.toISOString(),official:true,source_grade:src.grade??1};if(addCandidate(bucket,c)){added++;trace.added++}}
    trace.federal_register.push({source:src.id,term:src.term,items:items.length,added});
  }catch(e){trace.errors.push({source:src.id,error:String(e.message||e)})}
}
for(const b of Object.values(retrieval.mechanisms||{}))b.candidates=(b.candidates||[]).sort((a,b)=>(Number(b.official)-Number(a.official))||String(b.published_at||'').localeCompare(String(a.published_at||''))).slice(0,36);
retrieval.official_upstream={added:trace.added,errors:trace.errors.length,generated_at:now.toISOString()};
await fs.writeFile(retrievalPath,JSON.stringify(retrieval,null,2)+'\n');await fs.mkdir('data/upstream',{recursive:true});await fs.writeFile('data/upstream/latest.json',JSON.stringify(trace,null,2)+'\n');await fs.writeFile(`data/upstream/${retrieval.run_id}.json`,JSON.stringify(trace,null,2)+'\n');
console.log(`official upstream: added=${trace.added}, rss=${trace.rss.length}, federal_register=${trace.federal_register.length}, errors=${trace.errors.length}`);
