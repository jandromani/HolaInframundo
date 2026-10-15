import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {collectEvents,mergeWorldState,buildCompanyUniverse,buildShocks,makeAlerts,projectV6} from '../lib/v6-core.mjs';

const asOf='2026-10-16T00:00:00.000Z';
const evidence={claim:'Two vessels affected by physical disruption',source_url:'https://example.org/a',published_at:'2026-10-15T12:00:00Z'};
const m={id:'CRUDE_TANKER_DISLOCATION',score:52,score_delta:14,state:'ARMING',observed_evidence:[evidence,evidence]};
const clean=collectEvents(m,asOf);
assert.equal(clean.length,1,'same document should appear once');
assert.equal(clean[0].event_time_quality,'PUBLISHED_ONLY','do not invent event date');
const first=mergeWorldState({mechanisms:{CRUDE_TANKER_DISLOCATION:m},asOf});
assert.equal(first.CRUDE_TANKER_DISLOCATION.physical_evidence_status,'SINGLE_SOURCE_RECENT');
assert.equal(first.CRUDE_TANKER_DISLOCATION.physical_state,'NOT_DIRECTLY_MEASURED');
assert.equal(first.CRUDE_TANKER_DISLOCATION.events.length,1);
const withoutNew=mergeWorldState({mechanisms:{CRUDE_TANKER_DISLOCATION:{score:12,state:'DORMANT',observed_evidence:[]}},
 previous:first,asOf:'2026-10-18T00:00:00Z'});
assert.equal(withoutNew.CRUDE_TANKER_DISLOCATION.events.length,1,'do not erase physical history when news disappears');
assert.equal(withoutNew.CRUDE_TANKER_DISLOCATION.observation_freshness,'AGING');
const noSource=mergeWorldState({mechanisms:{X:{score:98,state:'ACTIVE',observed_evidence:[{claim:'unsourced',published_at:asOf}] }},asOf});
assert.equal(noSource.X.events.length,0,'no unsupported evidence');
assert.equal(noSource.X.physical_state,'NOT_DIRECTLY_MEASURED','a score does not prove physical disruption');
const names=buildCompanyUniverse({strategies:{CRUDE_TANKER_DISLOCATION:{top_candidates:[{
 symbol:'PSHG',fit:70,transmission:{score:68,financials:{fcf_margin:-2}},broker_available:true,broker_verified:false
}]}}});
assert.equal(names.company_count,1);
assert.equal(names.by_ticker.PSHG[0].data_quality.broker_verified,false);
assert.equal(names.by_ticker.PSHG[0].capture_status,'EXPOSURE_MODEL_ONLY');
const cfg=JSON.parse(await fs.readFile('config/shock-groups.v6.json','utf8'));
const config=JSON.parse(await fs.readFile('config/mechanisms.json','utf8'));
const edges=JSON.parse(await fs.readFile('config/edges.v2.json','utf8'));
const known=new Set(config.mechanisms.map(x=>x.id));
assert.equal(known.size,26,'keep all 26 mechanisms');
assert.ok(cfg.groups.length>=3);
assert.deepEqual(new Set(cfg.groups.flatMap(x=>x.mechanism_ids)),known,'all mechanisms mapped to shocks');
for(const e of edges.edges)assert.ok(known.has(e.from)&&known.has(e.to),'dangling graph edge '+JSON.stringify(e));
const ss=buildShocks({groups:cfg.groups,world:first,
 investment:{strategies:{}},edges:edges.edges,asOf});
assert.ok(ss.length>=1);
assert.ok(ss.every(x=>x.warning.includes('not an event probability')));
assert.equal(makeAlerts([],ss,first,asOf).filter(a=>a.type==='ESCALATION').length,0,'no fake initial escalation');
const output=projectV6({current:{run_id:'fixture',updated_at:asOf,mechanisms:{CRUDE_TANKER_DISLOCATION:m}},investment:{},
 pricing:{observations:{AISSTREAM:{status:'NOT_CONFIGURED',error:'missing key'}}},groups:cfg.groups,edges:edges.edges});
assert.equal(output.run_id,'fixture');
assert.equal(output.health.stale_or_unavailable_sources[0].source,'AISSTREAM');
assert.equal(output.health.warning.includes('No push'),true);
const html=await fs.readFile('index.html','utf8');
assert.ok(html.includes('data-view="world"')&&html.includes('data-view="transmission"')&&html.includes('data-view="theses"'));
assert.ok(html.includes('GearWatch V6'));
const js=await fs.readFile('lib/v6-dashboard.mjs','utf8');
assert.ok(js.includes('localStorage')&&js.includes('data/v6/homepage.json'));
const workflow=await fs.readFile('.github/workflows/scan.yml','utf8');
assert.ok(workflow.includes('npm run v6:publish')&&workflow.includes('npm run v6:test'));
console.log('GearWatch V6 contract checks passed');
