import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {bayesianUpdate,monteCarlo,brierScore} from '../lib/canary-probability.mjs';
import {buildCanaryEconomics} from '../lib/canary-001-economics.mjs';
const frozen=await fs.readFile('experiments/CANARY-001.preregistered.json');
const hash=crypto.createHash('sha1').update('blob '+frozen.length+'\0').update(frozen).digest('hex');
assert.equal(hash,'aa9b19f1efe5e077079a402a52402a21f0f69c01','never revise prereg after experiment starts');
const cfg=JSON.parse(await fs.readFile('config/canary-001-economic-scenarios.json','utf8'));
const r=buildCanaryEconomics(cfg,{asOf:'2026-10-15T23:59:59Z'});
assert.equal(r.experiment_id,'CANARY-001');
assert.equal(r.probabilistic_status,'UNIDENTIFIED');
assert.equal(r.bayesian_state.probability,null);
assert.equal(r.stochastic_model.expected_value,null);
assert.equal(r.expected_ebitda_usd,null);
assert.equal(r.expected_free_cash_flow_usd,null);
assert.equal(r.expected_return_pct,null);
assert.equal(r.probability_of_outperformance,null);
assert.equal(r.market_expectations_status,'NOT_ESTIMATED');
assert.equal(r.scenarios.length,3);
assert.equal(r.baseline.products.length,3);
const computed=179339*333+130818*433+35667*658;
assert.equal(r.baseline.reconstructed_netback_sales_usd,computed);
assert.equal(r.baseline.reported_netback_sales_usd,139883000);
assert.ok(Math.abs(r.baseline.reconciliation_gap_usd)<345824,'per-ton published figures are rounded');
const baseline=r.scenarios.find(x=>x.id==='UNCHANGED_NETBACK');
assert.equal(baseline.delta_netback_sales_usd,0);
assert.equal(baseline.stressed_netback_sales_usd,139883000);
const up=r.scenarios.find(x=>x.id==='HIGHER_REALIZATION');
const down=r.scenarios.find(x=>x.id==='LOWER_REALIZATION');
assert.ok(up.delta_netback_sales_usd>0);
assert.ok(down.delta_netback_sales_usd<0);
assert.equal(up.incremental_ebitda_usd,null);
assert.equal(down.expected_stock_return,null);
const uan=up.product_lines.find(x=>x.id==='UAN');
assert.equal(uan.stressed_volume_short_tons,Number((130818*1.1).toFixed(2)));
assert.equal(uan.stressed_netback_per_short_ton,497.95);
const corrupt=structuredClone(cfg);corrupt.historical_baseline.product_lines[0].volume_short_tons=-1;
assert.throws(()=>buildCanaryEconomics(corrupt,{asOf:'2026-10-15T23:59:59Z'}),/Invalid/);
const future=()=>buildCanaryEconomics(cfg,{asOf:'2026-06-01T00:00:00Z'});
assert.throws(future,/Future/);
const hypotheticalCalibration={id:'TOY_TEST_ONLY',status:'VALIDATED_OUT_OF_SAMPLE',sample_size:100,
 source_url:'https://example.org/heldout-calibration',dependencies_reviewed:true,calibrated_at:'2026-01-01T00:00:00Z'};
const prior={value:.2,source_url:'https://example.org/prior',as_of:'2026-01-01T00:00:00Z'};
const evidence=[
 {event_id:'EVENT_1',dependency_group:'ONE_ORIGINAL_EVENT',source_url:'https://example.org/news/a',
  observed_at:'2026-02-01T00:00:00Z',likelihood_ratio:3,calibration_id:'TOY_TEST_ONLY'},
 {event_id:'EVENT_1',dependency_group:'ONE_ORIGINAL_EVENT',source_url:'https://example.org/news/b',
  observed_at:'2026-02-01T01:00:00Z',likelihood_ratio:3,calibration_id:'TOY_TEST_ONLY'},
 {event_id:'EVENT_2',dependency_group:'ONE_ORIGINAL_EVENT',source_url:'https://example.org/news/c',
  observed_at:'2026-02-02T00:00:00Z',likelihood_ratio:2,calibration_id:'TOY_TEST_ONLY'}
];
const posterior=bayesianUpdate({prior,evidence,calibration:hypotheticalCalibration,asOf:'2026-02-03T00:00:00Z'});
assert.equal(posterior.status,'CALIBRATED_POINT_ESTIMATE');
assert.ok(Math.abs(posterior.probability-3/7)<1e-12,'one original event = one independent likelihood contribution');
assert.equal(posterior.applied.length,1);
assert.equal(posterior.applied[0].reports_in_group,2);
const sameGroupConflict=bayesianUpdate({prior,evidence:[evidence[0],{...evidence[1],event_id:'EVENT_DOWN',likelihood_ratio:0.4}],
 calibration:hypotheticalCalibration,asOf:'2026-02-03T00:00:00Z'});
assert.equal(sameGroupConflict.conflicted_groups.length,1);
assert.ok(Math.abs(sameGroupConflict.probability-.2)<1e-12,'contradictions cannot auto-amplify a posterior');
const noPrior=bayesianUpdate({evidence,calibration:hypotheticalCalibration,asOf:'2026-02-03T00:00:00Z'});
assert.equal(noPrior.status,'UNCALIBRATED');
assert.equal(noPrior.probability,null);
const futureEvidence=bayesianUpdate({prior,evidence:[{...evidence[0],observed_at:'2026-04-01T00:00:00Z'}],
 calibration:hypotheticalCalibration,asOf:'2026-02-03T00:00:00Z'});
assert.equal(futureEvidence.applied.length,0,'no future information leak');
const unsafe=monteCarlo({drivers:[{mean:0,stddev:1,coefficient:1,shared_factor_loading:0,calibration_id:'TOY_TEST_ONLY'}]});
assert.equal(unsafe.status,'UNCALIBRATED');
assert.equal(unsafe.expected_value,null);
const validDrivers=[
 {mean:10,stddev:2,coefficient:1,shared_factor_loading:1,calibration_id:'TOY_TEST_ONLY'},
 {mean:8,stddev:2,coefficient:1,shared_factor_loading:1,calibration_id:'TOY_TEST_ONLY'}
];
const sim=monteCarlo({drivers:validDrivers,calibration:hypotheticalCalibration,samples:5000,seed:88});
const sim2=monteCarlo({drivers:validDrivers,calibration:hypotheticalCalibration,samples:5000,seed:88});
assert.deepEqual(sim,sim2,'deterministic seeded sampling and common factor');
assert.equal(sim.status,'CONDITIONAL_DISTRIBUTION_ESTIMATE');
assert.ok(sim.quantiles.p05<sim.quantiles.p50&&sim.quantiles.p50<sim.quantiles.p95);
assert.ok(Math.abs(sim.expected_value-18)<.2);
assert.equal(brierScore([]).status,'INSUFFICIENT_OUTCOMES');
assert.equal(brierScore([{p:.5,outcome:1,committed_before_outcome:true}]).score,null);
const brier=brierScore(Array.from({length:30},(_,i)=>({p:.5,outcome:i%2,committed_before_outcome:true})));
assert.equal(brier.score,.25);
assert.equal(brierScore(Array.from({length:30},()=>({p:.5,outcome:1,committed_before_outcome:false}))).status,
 'INVALID_OR_UNREGISTERED_FORECASTS');
const script=await fs.readFile('scripts/canary-001-model.mjs','utf8');
assert.ok(!/placeOrder|submitOrder|executeOrder/i.test(script));
assert.ok(script.includes('registeredSha'));
console.log('CANARY probability + Q2 3-product unit economics / anti-fabrication tests PASS');
