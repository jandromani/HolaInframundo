import assert from 'node:assert/strict';
import {clusterEvidence,causalScore,hysteresisState,marketConfirmation,alphaClick} from './score.v2.mjs';
import {parseModelJson,normalizeParsed,mapConcurrent} from './extract-core.mjs';

const policy={
  event_clustering:{claim_jaccard_threshold:.5,max_time_gap_hours:72,min_token_length:4},
  state_gates:{active_confirmation_runs:2,deactivate_confirmation_runs:2,fast_path_causal:86},
  alpha:{min_causal:60,min_market:20,max_market:64,max_crowding:66,min_independent_domains:2,require_confirm:true,require_stable_active:true,max_lag_share:.45,reliability_gate_after_samples:5,min_empirical_reliability:.35}
};
const base={valid:true,contradiction:false,phase:'LEAD',signal:'REFINERY_OUTAGE',source_grade:.92,published_at:new Date().toISOString()};
const mirrored=[
  {...base,claim:'Major refinery extends hydrocracker outage after equipment failure',source_url:'https://reuters.com/a',source_domain:'reuters.com'},
  {...base,claim:'Major refinery extends its hydrocracker outage following equipment failure',source_url:'https://example.com/mirror',source_domain:'example.com'},
  {...base,claim:'Major refinery hydrocracker outage extended after equipment failure',source_url:'https://news.example/x',source_domain:'news.example'}
];
const clusters=clusterEvidence(mirrored,policy.event_clustering);
assert.equal(clusters.length,1,'syndicated mirrors must cluster into one event');
assert.equal(clusters[0].member_count,3);
const distinct=[...mirrored,{...base,claim:'Second refinery unexpectedly shuts diesel unit after fire',source_url:'https://apnews.com/b',source_domain:'apnews.com'}];
assert.equal(clusterEvidence(distinct,policy.event_clustering).length,2,'materially different events must remain separate');
const scored=causalScore(mirrored,[],policy.event_clustering);
assert.equal(scored.event_count,1);assert.equal(scored.duplicate_count,2);

const causal={score:72,total:3,counts:{LEAD:1,CONFIRM:1,LAG:0},domains:['a.com','b.com'],lag_share:0};
const first=hysteresisState({raw:'ACTIVE',previous:'ARMING',pending:null,causal,policy});
assert.equal(first.state,'ARMING');assert.equal(first.pending.streak,1);
const second=hysteresisState({raw:'ACTIVE',previous:'ARMING',pending:first.pending,causal,policy});
assert.equal(second.state,'ACTIVE','ACTIVE must require the configured persistence');
const down1=hysteresisState({raw:'WATCH',previous:'ACTIVE',pending:null,causal:{...causal,score:30},policy});
assert.equal(down1.state,'ACTIVE');assert.equal(down1.pending.streak,1);
const down2=hysteresisState({raw:'WATCH',previous:'ACTIVE',pending:down1.pending,causal:{...causal,score:30},policy});
assert.equal(down2.state,'WATCH','ACTIVE demotion must also require persistence');
const fast=hysteresisState({raw:'ACTIVE',previous:'ARMING',pending:null,causal:{...causal,score:90},policy});
assert.equal(fast.state,'ACTIVE','overwhelming causal evidence may use fast path');

const benchmark={ticker:'XLE',ret1:1,ret5:2,ret20:4,volumeZ:0,intraday:{ret30m:.2,ret2h:.4}};
const winner={ticker:'ASC',ret1:2,ret5:5,ret20:8,volumeZ:1.2,above20:true,above50:true,intraday:{ret30m:.6,ret2h:1.4}};
const laggard={ticker:'BAD',ret1:.5,ret5:1,ret20:2,volumeZ:.1,above20:true,above50:true,intraday:{ret30m:0,ret2h:.1}};
const strong=marketConfirmation({positive:[winner],negative:[],benchmark});
const weak=marketConfirmation({positive:[laggard],negative:[],benchmark});
assert.ok(strong.score>weak.score,'benchmark-relative winner must score higher than market laggard');
assert.ok(strong.avg.rel5>0&&strong.avg.rel2h>0);
assert.ok(weak.avg.rel5<0,'absolute gains below benchmark must be negative relative confirmation');
const shortWinner={ticker:'AIRLINE',ret1:-2,ret5:-4,ret20:-5,volumeZ:1,above20:false,above50:false,intraday:{ret30m:-.4,ret2h:-1}};
const inverse=marketConfirmation({positive:[],negative:[shortWinner],benchmark:{...benchmark,ret1:0,ret5:0,ret20:0,intraday:{ret30m:0,ret2h:0}}});
assert.ok(inverse.avg.rel5>0,'negative basket falling should confirm the mechanism direction');

const alphaBlocked=alphaClick({causal,market:{score:35,crowding:20},policy,reliability:{samples:0,hit_rate:null},state:'ARMING'});
assert.equal(alphaBlocked.eligible,false);assert.ok(alphaBlocked.reasons.includes('STATE_NOT_STABLY_ACTIVE'));
const alphaActive=alphaClick({causal,market:{score:35,crowding:20},policy,reliability:{samples:0,hit_rate:null},state:'ACTIVE'});
assert.equal(alphaActive.eligible,true,'stable ACTIVE plus valid early market confirmation should pass alpha gate');

const malformed='```json\n{"summary":"ok","items":[{"candidateId":"c1","fact":"refinery outage","relevance":0.9,}],"expectedNext":[],"invalidation":[],}\n```';
const repaired=parseModelJson(malformed);assert.ok(repaired.value,'local parser must repair trailing commas');
const normalized=normalizeParsed(repaired.value);assert.equal(normalized.items[0].candidate_id,'c1');assert.equal(normalized.items[0].claim,'refinery outage');assert.equal(normalized.items[0].fact_type,'FACT');
const partial=normalizeParsed({overview:'x',evidence:[{sourceId:'a',statement:'b'}]});assert.equal(partial.summary,'x');assert.equal(partial.expected_next.length,0);assert.equal(partial.invalidation.length,0);
let active=0,maxActive=0;const outputs=await mapConcurrent([1,2,3,4,5],3,async x=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,10));active--;return x*2});assert.deepEqual(outputs,[2,4,6,8,10]);assert.ok(maxActive<=3&&maxActive>=2,'concurrency helper must bound parallel work');

console.log('GearWatch V2.4 selftest OK: causal gates + extractor repair/normalization/concurrency');
