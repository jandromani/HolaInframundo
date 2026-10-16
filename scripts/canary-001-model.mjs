// Produce a reproducible *research* sensitivity report, never a real-money forecast.
// The original preregistered Canary-001 is immutable and checked against its Git blob.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {buildCanaryEconomics} from '../lib/canary-001-economics.mjs';
const preregPath='experiments/CANARY-001.preregistered.json';
const source=await fs.readFile(preregPath);
const preregSha=crypto.createHash('sha1').update('blob '+source.byteLength+'\0').update(source).digest('hex');
const registeredSha='aa9b19f1efe5e077079a402a52402a21f0f69c01';
if(preregSha!==registeredSha)throw new Error('Immutable preregistered Canary-001 has changed: '+preregSha);
const registered=JSON.parse(source.toString('utf8'));
if(registered.experiment_id!=='CANARY-001'||registered.status!=='PREREGISTERED_RESEARCH_ONLY')
 throw new Error('Unrecognized preregistration');
const cfg=JSON.parse(await fs.readFile('config/canary-001-economic-scenarios.json','utf8'));
const report=buildCanaryEconomics(cfg,{
 // Fixed as-known cutoff for the first experiment. Future disclosures require a
 // separately versioned, newly dated model snapshot and cannot change this report.
 asOf:'2026-10-15T23:59:59Z'
});
report.preregistration_git_blob_sha=registeredSha;
report.model_snapshot_class='AS_KNOWN_BEFORE_2026_10_16_SESSION';
report.title='Canary-001 / LXU — nitrogen economics, NOT a calibrated price forecast';
report.next_required_evidence=[
 'Two independent dated physical sources measuring fertilizer shipping/supply',
 'Post-registered comparable UAN price series (same basis/unit/region)',
 'LXU disclosed production, price netbacks and maintenance',
 'LXU gas volume / cost pass-through and variable manufacturing expense',
 'Dated consensus expectations and comparables for CF'
];
await fs.mkdir('data/experiments',{recursive:true});
const path='data/experiments/CANARY-001.model.json';
await fs.writeFile(path,JSON.stringify(report,null,2)+'\n');
console.log('CANARY-001 model ready: 3 unweighted scenarios, '+report.baseline.products.length+
 ' product lines, '+report.probabilistic_status+', expected_return withheld');
