import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const html=await fs.readFile('investment.html','utf8'),js=await fs.readFile('lib/investment-dashboard.mjs','utf8');
for(const id of ['summary','leaders','rows','filters','health'])assert.ok(html.includes(`id="${id}"`),`missing UI anchor ${id}`);
for(const token of ['ret7','ret30','ret90','ret180','fcf_yield','ev_to_ebitda','net_debt_to_ebitda','dilution_yoy','blind_sensors'])assert.ok(js.includes(token),`missing human metric ${token}`);
assert.ok(html.includes('no genera órdenes')&&html.includes('asesoramiento financiero'),'guardrail copy missing');
console.log('investment UI selftest: PASS');
