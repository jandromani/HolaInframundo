import fs from 'node:fs/promises';
const invPath='data/investment-layer.json';
const inv=JSON.parse(await fs.readFile(invPath,'utf8').catch(()=>'{"strategies":{}}'));
const sensors=JSON.parse(await fs.readFile('data/pricing-sensors.json','utf8').catch(()=>'{"mechanisms":{}}'));
const clamp=x=>Math.max(0,Math.min(100,Number(x)||0));
for(const [id,s] of Object.entries(inv.strategies||{})){
 const p=sensors.mechanisms?.[id]||{},equity=Number.isFinite(Number(s.priced_in))?Number(s.priced_in):null,primary=Number.isFinite(Number(p.primary_priced_in))?Number(p.primary_priced_in):null,confidence=clamp(p.pricing_confidence||0);
 let composite=equity;
 if(primary!=null&&equity!=null){const w=.25+.55*(confidence/100);composite=(1-w)*equity+w*primary}else if(primary!=null)composite=primary;
 s.equity_priced_in=equity;s.primary_priced_in=primary;s.pricing_confidence=Math.round(confidence);s.pricing_sources=p.sources||[];s.priced_in=Number.isFinite(composite)?Math.round(clamp(composite)):0;s.pricing_method=primary==null?'EQUITY_PROXY_ONLY':'PRIMARY_PLUS_EQUITY';
 if(primary==null)s.pricing_warning='Primary pricing sensors are not yet observed; priced_in is still an equity/crowd proxy.';
}
inv.pricing_sensors={version:sensors.version||null,generated_at:sensors.generated_at||null,coverage:sensors.coverage||{}};
await fs.writeFile(invPath,JSON.stringify(inv,null,2)+'\n');console.log(`pricing overlay: ${Object.keys(inv.strategies||{}).length} strategies enriched`);
