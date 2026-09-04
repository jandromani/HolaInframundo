import fs from 'node:fs/promises';

const seeds=JSON.parse(await fs.readFile('config/investment-seeds.json','utf8'));
const KEY=process.env.TRADING212_API_KEY||'';
const SECRET=process.env.TRADING212_API_SECRET||'';
const now=new Date().toISOString();
const uniq=[...new Set(Object.values(seeds.mechanisms||{}).flat().map(x=>x[0]))];
const baseSymbol=s=>String(s).split('.')[0].toUpperCase();
const slugFor=s=>{const [b,suf]=String(s).split('.');if(!suf)return `${b}.US`;const map={L:'GB',MI:'IT',PA:'FR',OL:'NO',ST:'SE',AS:'NL',AT:'GR',T:'JP',AX:'AU'};return `${b}.${map[suf]||suf}`};
const regionFor=s=>{const suf=(String(s).split('.')[1]||'US').toUpperCase();return ({L:'GB',MI:'IT',PA:'FR',DE:'DE',OL:'NO',ST:'SE',AS:'NL',AT:'GR',T:'JP',AX:'AU'})[suf]||'US'};
const regionMatch=(name,region)=>{name=String(name||'').toLowerCase();const tests={US:/nyse|nasdaq|american|arca|otc/,GB:/london/,DE:/xetra|gettex|frankfurt/,IT:/milan|italiana/,FR:/paris/,NO:/oslo/,SE:/stockholm/,NL:/amsterdam/,GR:/athens/,JP:/tokyo/,AU:/austral/};return tests[region]?.test(name)??true};
const skeleton=Object.fromEntries(uniq.map(symbol=>[symbol,{symbol,broker:'Trading 212 Invest',broker_slug:slugFor(symbol),broker_url:`https://www.trading212.com/es/trading-instruments/invest/${slugFor(symbol)}`,available:null,verified:false}]));
const out={version:'2.6.0',generated_at:now,broker:'Trading 212',mode:'UNVERIFIED',authoritative:false,credentials_configured:Boolean(KEY&&SECRET),instruments:skeleton,stats:{seed_symbols:uniq.length,verified:0,available:0,unavailable:0},errors:[]};
async function get(path){const auth=Buffer.from(`${KEY}:${SECRET}`).toString('base64');const r=await fetch(`https://live.trading212.com/api/v0${path}`,{headers:{Authorization:`Basic ${auth}`,'User-Agent':'GearWatch/2.6 broker-metadata'},signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error(`Trading212 ${r.status}: ${(await r.text()).slice(0,180)}`);return r.json()}
if(KEY&&SECRET){
  try{
    const [instruments,exchanges]=await Promise.all([get('/equity/metadata/instruments'),get('/equity/metadata/exchanges')]);
    const exById=new Map((exchanges||[]).map(x=>[x.id,x.name]));
    const stocks=(instruments||[]).filter(x=>String(x.type).toUpperCase()==='STOCK');
    for(const symbol of uniq){const b=baseSymbol(symbol),region=regionFor(symbol),matches=stocks.filter(x=>String(x.shortName||'').toUpperCase()===b||String(x.ticker||'').toUpperCase().startsWith(`${b}_`));const exact=matches.find(x=>regionMatch(exById.get(x.workingScheduleId),region))||matches[0]||null;const row=out.instruments[symbol];row.verified=true;row.available=Boolean(exact);if(exact){row.name=exact.name||exact.shortName||b;row.short_name=exact.shortName||b;row.t212_ticker=exact.ticker;row.isin=exact.isin||null;row.currency=exact.currencyCode||null;row.extended_hours=Boolean(exact.extendedHours);row.exchange=exById.get(exact.workingScheduleId)||null}}
    out.mode='OFFICIAL_API';out.authoritative=true;out.stats.verified=uniq.length;out.stats.available=Object.values(out.instruments).filter(x=>x.available===true).length;out.stats.unavailable=uniq.length-out.stats.available;
  }catch(e){out.errors.push(String(e.message||e));out.mode='API_ERROR';}
}else out.errors.push('TRADING212_API_KEY/TRADING212_API_SECRET not configured; availability remains unverified.');
await fs.writeFile('data/broker.json',JSON.stringify(out,null,2)+'\n');
console.log(`broker: mode=${out.mode} seeds=${uniq.length} verified=${out.stats.verified} available=${out.stats.available}`);
