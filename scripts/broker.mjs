import fs from 'node:fs/promises';

const seeds=JSON.parse(await fs.readFile('config/investment-seeds.json','utf8'));
const path='data/broker.json';
const prev=JSON.parse(await fs.readFile(path,'utf8').catch(()=>'{"instruments":{}}'));
const now=new Date(),nowIso=now.toISOString(),TTL=7*24*3600*1000;
const uniq=[...new Set(Object.values(seeds.mechanisms||{}).flat().map(x=>x[0]))];
const baseSymbol=s=>String(s).split('.')[0].toUpperCase();
const slugFor=s=>{const [b,suf]=String(s).split('.');if(!suf)return `${b}.US`;const map={L:'GB',MI:'IT',PA:'FR',OL:'NO',ST:'SE',AS:'NL',AT:'GR',T:'JP',AX:'AU'};return `${b}.${map[suf]||suf}`};
const urlFor=s=>`https://www.trading212.com/es/trading-instruments/invest/${slugFor(s)}`;
const fresh=x=>{const t=Date.parse(x?.checked_at||'');return Boolean(x?.verified)&&Number.isFinite(t)&&Date.now()-t<TTL};
const escapeRe=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const skeleton=Object.fromEntries(uniq.map(symbol=>[symbol,{symbol,broker:'Trading 212 Invest',broker_slug:slugFor(symbol),broker_url:urlFor(symbol),available:null,verified:false,verification_source:'PUBLIC_CATALOGUE'}]));
const out={version:'2.7.0',generated_at:nowIso,broker:'Trading 212 Invest',mode:'PUBLIC_CATALOGUE',authoritative:false,account_specific:false,credentials_required:false,catalogue_verified:false,availability_gate:false,instruments:skeleton,stats:{seed_symbols:uniq.length,verified:0,available:0,unavailable:0,unknown:uniq.length,cache_hits:0,network_checks:0},errors:[]};

async function check(symbol){
  const url=urlFor(symbol),base=baseSymbol(symbol);let lastErr=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; GearWatch/2.7; public catalogue checker)','accept-language':'es-ES,es;q=0.9,en;q=0.7'},signal:AbortSignal.timeout(18000)});
      const status=r.status;
      if(status===404)return {symbol,checked_at:nowIso,verified:true,available:false,http_status:404,verification_source:'PUBLIC_CATALOGUE',broker_slug:slugFor(symbol),broker_url:url};
      const text=await r.text(),title=(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/\s+/g,' ').trim(),hasInstrument=/Invierte en|Invest in|Compra y vende acciones|Comprar/i.test(text),mentions=new RegExp(`\\b${escapeRe(base)}\\b`,'i').test(title+' '+text.slice(0,220000));
      if(status===200&&hasInstrument&&mentions){const m=title.match(/(?:Invierte en|Invest in)\s+(.+?),\s*([^:]+):/i),isin=text.match(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/)?.[0]||null;return {symbol,checked_at:nowIso,verified:true,available:true,http_status:200,verification_source:'PUBLIC_CATALOGUE',broker_slug:slugFor(symbol),broker_url:url,name:m?.[1]?.trim()||base,exchange:m?.[2]?.trim()||null,isin,title}}
      if(status===429||status>=500){lastErr=`HTTP ${status}`;await new Promise(r=>setTimeout(r,900*(attempt+1)));continue}
      return {symbol,checked_at:nowIso,verified:false,available:null,http_status:status,verification_source:'PUBLIC_CATALOGUE',broker_slug:slugFor(symbol),broker_url:url,title,error:'Public page did not expose a verifiable instrument marker.'};
    }catch(e){lastErr=String(e.message||e);await new Promise(r=>setTimeout(r,700*(attempt+1)))}
  }
  return {symbol,checked_at:nowIso,verified:false,available:null,verification_source:'PUBLIC_CATALOGUE',broker_slug:slugFor(symbol),broker_url:url,error:lastErr||'Unknown public catalogue error'}
}
async function mapConcurrent(items,limit,fn){const out=new Array(items.length);let i=0;async function worker(){for(;;){const n=i++;if(n>=items.length)return;out[n]=await fn(items[n]);await new Promise(r=>setTimeout(r,110))}}await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out}

const pending=[];
for(const symbol of uniq){const old=prev.instruments?.[symbol];if(fresh(old)){out.instruments[symbol]={...skeleton[symbol],...old,broker_url:urlFor(symbol),broker_slug:slugFor(symbol),verification_source:'PUBLIC_CATALOGUE'};out.stats.cache_hits++}else pending.push(symbol)}
const checked=await mapConcurrent(pending,5,check);out.stats.network_checks=checked.length;
for(const row of checked){const old=prev.instruments?.[row.symbol];if(!row.verified&&old?.verified&&old.available===true)out.instruments[row.symbol]={...skeleton[row.symbol],...old,stale:true,last_error:row.error,broker_url:urlFor(row.symbol),broker_slug:slugFor(row.symbol),verification_source:'PUBLIC_CATALOGUE'};else out.instruments[row.symbol]={...skeleton[row.symbol],...row};if(row.error)out.errors.push({symbol:row.symbol,error:row.error,http_status:row.http_status??null})}
out.stats.verified=Object.values(out.instruments).filter(x=>x.verified).length;out.stats.available=Object.values(out.instruments).filter(x=>x.verified&&x.available===true).length;out.stats.unavailable=Object.values(out.instruments).filter(x=>x.verified&&x.available===false).length;out.stats.unknown=uniq.length-out.stats.verified;const coverage=out.stats.verified/Math.max(1,uniq.length);out.catalogue_verified=coverage>=.8;out.availability_gate=out.catalogue_verified;out.mode=out.catalogue_verified?'PUBLIC_CATALOGUE':'PUBLIC_CATALOGUE_PARTIAL';out.coverage=+coverage.toFixed(3);
await fs.writeFile(path,JSON.stringify(out,null,2)+'\n');
console.log(`broker: mode=${out.mode} public=${out.stats.verified}/${uniq.length} available=${out.stats.available} unavailable=${out.stats.unavailable} unknown=${out.stats.unknown} cache=${out.stats.cache_hits}`);
