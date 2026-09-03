import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const mechCfg=JSON.parse(await fs.readFile('config/mechanisms.json','utf8'));
const queryCfg=JSON.parse(await fs.readFile('config/queries.v2.json','utf8'));
const extraCfg=JSON.parse(await fs.readFile('config/queries.v2.extra.json','utf8').catch(()=>'{"mechanisms":{}}'));
const querySets={...(queryCfg.mechanisms||{}),...(extraCfg.mechanisms||{})};
const previous=JSON.parse(await fs.readFile('data/current.json','utf8').catch(()=>'{"mechanisms":{}}'));
const now=new Date();
const hour=now.getUTCHours();
const runId=process.env.GEARWATCH_RUN_ID||`run_${now.toISOString().replace(/[:.]/g,'-')}`;
const MAX=queryCfg.defaults?.max_results_per_query||8;

const shouldRun=m=>m.tier==='A'||(m.tier==='B'&&hour%12===0)||(m.tier==='C'&&hour===0);
const selected=mechCfg.mechanisms.filter(shouldRun);

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,20);
const stripHtml=s=>String(s||'').replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
const xmlTag=(block,tag)=>{const m=block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'i'));return m?stripHtml(m[1]):''};
const sourceTag=block=>{const m=block.match(/<source(?:\s+url="([^"]+)")?>([\s\S]*?)<\/source>/i);return m?{url:m[1]||'',name:stripHtml(m[2])}:{url:'',name:''}};
const domainOf=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return ''}};

async function safeFetch(url,attempts=2){
  let last;
  for(let i=0;i<attempts;i++){
    try{
      const r=await fetch(url,{headers:{'user-agent':'GearWatch/2.0 causal-research'},signal:AbortSignal.timeout(15000)});
      if(r.status===429){const wait=Math.min(15000,Number(r.headers.get('retry-after')||2)*1000);await sleep(wait);last=new Error('HTTP 429');continue}
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      return r;
    }catch(e){last=e;if(i+1<attempts)await sleep(800+Math.random()*700)}
  }
  throw last;
}

async function gdelt(query,windowHours){
  const end=new Date(),start=new Date(end.getTime()-windowHours*3600e3);
  const fmt=d=>d.toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
  const url=`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=${MAX}&format=json&sort=DateDesc&startdatetime=${fmt(start)}&enddatetime=${fmt(end)}`;
  const r=await safeFetch(url),j=await r.json();
  return (j.articles||[]).slice(0,MAX).map(a=>({engine:'gdelt',title:a.title||'',url:a.url||'',domain:a.domain||domainOf(a.url),source_name:a.domain||domainOf(a.url),published_at:a.seendate||'',snippet:'',language:a.language||'',source_country:a.sourcecountry||''}));
}

async function googleNews(query,windowHours){
  const days=Math.max(1,Math.ceil(windowHours/24)),q=`${query} when:${days}d`;
  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const r=await safeFetch(url),xml=await r.text();
  const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,MAX).map(x=>x[1]);
  return items.map(block=>{const src=sourceTag(block),link=xmlTag(block,'link');return {engine:'google_news',title:xmlTag(block,'title'),url:link,domain:domainOf(src.url)||domainOf(link),source_name:src.name||domainOf(link),published_at:xmlTag(block,'pubDate'),snippet:xmlTag(block,'description'),language:'',source_country:''}});
}

function phasesFor(m,q){
  const prev=previous.mechanisms?.[m.id]||{},phases=['lead'];
  const warmed=(prev.score||0)>=25||['WATCH','ARMING','ACTIVE','SATURATED'].includes(prev.state);
  if(warmed||m.tier==='A'&&(hour===0||hour===12))phases.push('confirm');
  if(['ACTIVE','SATURATED'].includes(prev.state)||prev.alpha?.eligible)phases.push('lag');
  return phases.filter(p=>Array.isArray(q?.[p])&&q[p].length);
}

const output={version:'2.0.1',run_id:runId,generated_at:now.toISOString(),window_hours:queryCfg.defaults?.window_hours||30,mechanisms:{},errors:[],request_count:0};
for(const m of selected){
  const qset=querySets[m.id];
  if(!qset){output.errors.push({mechanism_id:m.id,error:'Missing V2 query config'});continue}
  const bucket={id:m.id,label:m.label,tier:m.tier,queries:[],candidates:[]},dedupe=new Map();
  for(const phase of phasesFor(m,qset)){
    for(const query of qset[phase]){
      const queryId=`${m.id}:${phase}:${query.id}`;
      const trace={query_id:queryId,phase:phase.toUpperCase(),signal:query.signal,q:query.q,engines:{},started_at:new Date().toISOString()};
      for(const engine of queryCfg.defaults?.retrievers||['gdelt','google_news']){
        try{
          const rows=engine==='gdelt'?await gdelt(query.q,output.window_hours):await googleNews(query.q,output.window_hours);output.request_count++;trace.engines[engine]={ok:true,count:rows.length};
          for(const row of rows){
            const key=(row.url||row.title).toLowerCase().replace(/[?#].*$/,'');if(!key)continue;
            const item={id:hash(`${queryId}|${row.url}|${row.title}`),mechanism_id:m.id,query_id:queryId,phase:phase.toUpperCase(),signal:query.signal,query:query.q,...row,retrieved_at:new Date().toISOString()};
            const existing=dedupe.get(key);if(!existing)dedupe.set(key,item);else existing.matched_queries=[...new Set([...(existing.matched_queries||[existing.query_id]),queryId])];
          }
        }catch(e){output.request_count++;trace.engines[engine]={ok:false,error:String(e.message||e)};output.errors.push({mechanism_id:m.id,query_id:queryId,engine,error:String(e.message||e)})}
        await sleep(220);
      }
      trace.finished_at=new Date().toISOString();bucket.queries.push(trace);
    }
  }
  bucket.candidates=[...dedupe.values()].sort((a,b)=>String(b.published_at).localeCompare(String(a.published_at))).slice(0,36);output.mechanisms[m.id]=bucket;
}

await fs.mkdir('data/retrieval',{recursive:true});await fs.writeFile('data/retrieval/latest.json',JSON.stringify(output,null,2)+'\n');await fs.writeFile(`data/retrieval/${runId}.json`,JSON.stringify(output,null,2)+'\n');
console.log(`retrieval ${runId}: ${Object.keys(output.mechanisms).length} mechanisms, ${output.request_count} source requests, ${output.errors.length} errors`);
