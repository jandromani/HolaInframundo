import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const cfg=JSON.parse(await fs.readFile('config/pricing-sensors.json','utf8'));const mechs=JSON.parse(await fs.readFile('config/mechanisms.json','utf8')).mechanisms||[];
assert.equal(cfg.version,'4.3.0');for(const m of mechs){assert.ok(Array.isArray(cfg.mechanisms[m.id])&&cfg.mechanisms[m.id].length>0,`missing pricing sensors for ${m.id}`);for(const s of cfg.mechanisms[m.id])assert.ok(cfg.sources[s],`unknown source ${s} for ${m.id}`)}
for(const [id,s] of Object.entries(cfg.sources)){assert.ok(cfg.families.includes(s.family),`bad family ${id}`);assert.ok(s.access&&s.status&&s.url,`incomplete source ${id}`)}
for(const s of ['AISSTREAM','EIA','MOF_JGB','MOF_FLOWS','USA_SPENDING','SAM_GOV','CFTC_COT','UKMTO','ENTSOE','UN_COMTRADE'])assert.ok(cfg.sources[s],`missing primary adapter registry ${s}`);
console.log(`pricing sensor config v4.3 OK: ${mechs.length} mechanisms / ${Object.keys(cfg.sources).length} sources / 8 primary blocks`);
