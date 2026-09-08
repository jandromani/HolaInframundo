import assert from 'node:assert/strict';
import {guardMechanismEvidence,pricingSensorMeta} from './mechanism-guards.mjs';

const rows=[
  {valid:true,signal:'CEYHAN_FLOW',claim:'Iraq-Turkey pipeline exports through Ceyhan reach sustained daily flow'},
  {valid:true,signal:'STS_TRANSFER',claim:'Iraq ships above 2 million bpd via tanker transfers outside Hormuz'}
];
const guarded=guardMechanismEvidence('CEYHAN_BYPASS',rows);
assert.equal(guarded.accepted.length,1);
assert.equal(guarded.rejected.length,1);
assert.equal(guarded.rejected[0].semantic_rejection,'CEYHAN_REQUIRES_PIPELINE_SPECIFIC_EVIDENCE');
assert.equal(pricingSensorMeta('JAPAN_CARRY_UNWIND').confidence,'LOW');
assert.equal(pricingSensorMeta('DIESEL_REFINING_CRISIS').confidence,'HIGH');
console.log('GearWatch V4.1 guard selftest OK');
