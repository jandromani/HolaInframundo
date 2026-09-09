import assert from 'node:assert/strict';
import {sanitizeKalshi} from './pricing-quality.mjs';
const obs={mechanisms:{UNDERWATER_SECURITY:{hits:[{title:'Will a tanker be attacked in the Strait of Hormuz?',ticker:'HORMUZ-TANKER',last_price:.61,volume:100,open_interest:20},{title:'NBA parlay: Iran team scores 100 points',ticker:'NBA-IRAN',last_price:.9,volume:1000,open_interest:500}]},CHEAP_DRONE_SCALING:{hits:[{title:'Will military drone procurement rise during the war?',ticker:'DRONE-WAR',last_price:.55,volume:50,open_interest:10},{title:'Drone Racing League match winner',ticker:'SPORT-DRONE',last_price:.2,volume:100,open_interest:10}]}}};
sanitizeKalshi(obs);
assert.equal(obs.mechanisms.UNDERWATER_SECURITY.hits.length,1);assert.equal(obs.mechanisms.CHEAP_DRONE_SCALING.hits.length,1);assert.ok(obs.rejected_semantic_hits>=2);assert.ok(Number.isFinite(obs.mechanisms.UNDERWATER_SECURITY.pricing_score));
console.log('pricing quality semantic guard OK');
