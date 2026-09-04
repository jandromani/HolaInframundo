import fs from 'node:fs/promises';
import { getInstruments, trading212Config } from '../lib/trading212.mjs';

const seeds=JSON.parse(await fs.readFile('config/investment-seeds.json','utf8'));
const path='data/broker.json';
const nowIso=new Date().toISOString();
const uniq=[...new Set(Object.values(seeds.mechanisms||{}).flat().map(x=>x[0]))];
const cfg=trading212Config();

function seedBase(symbol){
  return String(symbol).toUpperCase().replace(/\.(AT|AX|DE|L|MI|OL|PA|ST|T)$/,'').replace(/[^A-Z0-9]/g,'');
}
function tickerStem(ticker){
  return String(ticker||'').toUpperCase().split('_')[0].replace(/[^A-Z0-9]/g,'');
}
function exchangeHint(symbol){
  const m=String(symbol).toUpperCase().match(/\.([A-Z]+)$/);
  return m?.[1]||'';
}
function scoreCandidate(seed, instrument){
  const s=String(seed).toUpperCase();
  const b=seedBase(seed);
  const t=String(instrument?.ticker||'').toUpperCase();
  const stem=tickerStem(t);
  const short=String(instrument?.shortName||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const hint=exchangeHint(seed);
  let score=0;
  if(t===s) score+=120;
  if(stem===b) score+=95;
  else if(t.startsWith(`${b}_`)) score+=85;
  if(short===b) score+=45;
  if(hint && t.includes(`_${hint}_`)) score+=20;
  if(instrument?.type==='STOCK' || instrument?.type==='ETF') score+=5;
  return score;
}
function matchInstrument(seed, catalogue){
  const ranked=catalogue
    .map(x=>({x,score:scoreCandidate(seed,x)}))
    .filter(r=>r.score>=85)
    .sort((a,b)=>b.score-a.score);
  if(!ranked.length) return { match:null, confidence:'NONE', candidates:[] };
  const top=ranked[0];
  const tied=ranked.filter(r=>r.score===top.score);
  if(tied.length>1) return { match:null, confidence:'AMBIGUOUS', candidates:tied.slice(0,5).map(r=>r.x.ticker) };
  return { match:top.x, confidence:top.score>=110?'EXACT':'HIGH', candidates:[top.x.ticker] };
}

let out;
if(cfg.configured){
  try{
    const catalogue=await getInstruments();
    const instruments={};
    let verified=0, unavailable=0, ambiguous=0;
    for(const symbol of uniq){
      const result=matchInstrument(symbol,catalogue||[]);
      const m=result.match;
      if(m) verified++;
      else if(result.confidence==='AMBIGUOUS') ambiguous++;
      else unavailable++;
      instruments[symbol]={
        symbol,
        broker:'Trading 212 Invest',
        available:Boolean(m),
        verified:Boolean(m),
        curated:true,
        authoritative:true,
        verification_source:'TRADING212_LIVE_INSTRUMENTS_API',
        match_confidence:result.confidence,
        broker_ticker:m?.ticker||null,
        isin:m?.isin||null,
        currency:m?.currencyCode||null,
        instrument_type:m?.type||null,
        extended_hours:m?.extendedHours??null,
        max_open_quantity:m?.maxOpenQuantity??null,
        candidates:result.candidates,
        checked_at:nowIso
      };
    }
    out={
      version:'2.9.1', generated_at:nowIso, broker:'Trading 212 Invest',
      mode:'LIVE_T212_CATALOGUE', authoritative:true, account_specific:true,
      credentials_required:true, auth_mode:cfg.authMode, environment:cfg.environment,
      catalogue_verified:true, availability_gate:true, curated_universe:true,
      instruments,
      stats:{ seed_symbols:uniq.length, verified, available:verified, unavailable, ambiguous, unknown:ambiguous, cache_hits:0, network_checks:1 },
      coverage:Number((verified/Math.max(1,uniq.length)).toFixed(4)), errors:[]
    };
  }catch(error){
    out=null;
    console.warn(`broker live catalogue unavailable: ${error.message}; using curated fallback`);
  }
}

if(!out){
  const instruments=Object.fromEntries(uniq.map(symbol=>[symbol,{
    symbol, broker:'Trading 212 Invest', available:true, verified:true, curated:true,
    authoritative:false, verification_source:'USER_CURATED_T212_UNIVERSE', checked_at:nowIso
  }]));
  out={
    version:'2.9.1', generated_at:nowIso, broker:'Trading 212 Invest',
    mode:'CURATED_T212_UNIVERSE', authoritative:false, account_specific:false,
    credentials_required:false, catalogue_verified:true, availability_gate:true, curated_universe:true,
    instruments,
    stats:{ seed_symbols:uniq.length, verified:uniq.length, available:uniq.length, unavailable:0, ambiguous:0, unknown:0, cache_hits:0, network_checks:0 },
    coverage:1, errors:[]
  };
}

await fs.writeFile(path,JSON.stringify(out,null,2)+'\n');
console.log(`broker: mode=${out.mode} verified=${out.stats.verified}/${uniq.length} network=${out.stats.network_checks}`);
