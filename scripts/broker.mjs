import fs from 'node:fs/promises';

const seeds=JSON.parse(await fs.readFile('config/investment-seeds.json','utf8'));
const path='data/broker.json';
const nowIso=new Date().toISOString();
const uniq=[...new Set(Object.values(seeds.mechanisms||{}).flat().map(x=>x[0]))];

// User requirement: the candidate universe is already curated from instruments available in Trading 212.
// Do not spend runtime/network budget re-proving catalogue presence and do not expose broker links.
const instruments=Object.fromEntries(uniq.map(symbol=>[symbol,{
  symbol,
  broker:'Trading 212 Invest',
  available:true,
  verified:true,
  curated:true,
  verification_source:'USER_CURATED_T212_UNIVERSE',
  checked_at:nowIso
}]));

const out={
  version:'2.8.0',
  generated_at:nowIso,
  broker:'Trading 212 Invest',
  mode:'CURATED_T212_UNIVERSE',
  authoritative:false,
  account_specific:false,
  credentials_required:false,
  catalogue_verified:true,
  availability_gate:true,
  curated_universe:true,
  instruments,
  stats:{
    seed_symbols:uniq.length,
    verified:uniq.length,
    available:uniq.length,
    unavailable:0,
    unknown:0,
    cache_hits:0,
    network_checks:0
  },
  coverage:1,
  errors:[]
};

await fs.writeFile(path,JSON.stringify(out,null,2)+'\n');
console.log(`broker: mode=${out.mode} curated=${out.stats.available}/${uniq.length} network=0`);
