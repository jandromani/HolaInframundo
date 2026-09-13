import fs from 'node:fs/promises';

const guide=await fs.readFile('lib/economist-human-guide.mjs','utf8');
const live=await fs.readFile('lib/economist-live-evidence.mjs','utf8');
const scan=await fs.readFile('.github/workflows/scan.yml','utf8');
const snapshot=await fs.readFile('scripts/window-snapshot.mjs','utf8');
const score=await fs.readFile('scripts/score.v2.mjs','utf8');
const fail=[];
const gate=(name,ok,why)=>{console.log(`${ok?'PASS':'FAIL'} · ${name}`);if(!ok)fail.push(`${name}: ${why}`)};

gate('Human mode visible',guide.includes('HUMAN MODE · LEER EN 60 SEGUNDOS')&&guide.includes('¿QUÉ SIGNIFICA TODO?'),'The economist banner must offer a plain-language entry point.');
gate('Every definition says what not to infer',guide.includes('Qué NO significa')&&guide.includes('NO es una probabilidad')&&guide.includes('Nunca se usa para aumentar causalidad'),'Human explanations must explicitly block common misreadings.');
gate('Core KPI dictionary', ['AstroShock Alignment','Physical Shock / Shock Pressure','OpenAI Semantic Pressure','Priced-in','Causal − Pricing Gap','Sensor Confidence'].every(x=>guide.includes(x)),'Top-line indicators need plain-language definitions.');
gate('Research-stat dictionary', ['Surprise vs baseline (z-score)','Percentil de referencia','Δ24h / Δ7d','Physical ↔ Pricing','Astro Timing ↔ Physical'].every(x=>guide.includes(x)),'Audit statistics need definitions.');
gate('Mechanism-state dictionary',guide.includes('DORMANT <25')&&guide.includes('WATCH ≥25')&&guide.includes('ARMING ≥45')&&guide.includes('ACTIVE ≥65'),'State thresholds must be transparent.');
gate('Lead confirm lag explained',['LEAD','CONFIRM','LAG'].every(x=>guide.includes(`title:'${x}'`)),'Sensor phases need human definitions.');
gate('Escalation Delta exists',guide.includes("title:'Escalation Delta'")&&guide.includes('primer checkpoint LIVE'),'Users must be able to answer whether the situation worsened since monitoring began.');
gate('Graph lag visible',guide.includes("title:'Graph Lag'")&&guide.includes('GRAPH LAG'),'Dashboard must disclose when engine state is newer than plotted history.');
gate('Graph axes explained',guide.includes('El eje horizontal es tiempo')&&guide.includes('índices internos comparables consigo mismos')&&guide.includes('no probabilidades'),'0–100 chart scale must never be mistaken for probability.');
gate('Dynamic loading chain',live.includes('economist-human-guide.mjs')&&live.includes('loadHumanGuide'),'Production-loaded economist evidence must chain into Human Mode.');
gate('Every hardened scan refreshes research',scan.includes('npm run window:research'),'6h scans must refresh the research ledger.');
gate('Every hardened scan persists a chart point',scan.includes('npm run window:snapshot'),'6h scans must never advance current.json without advancing the graph.');
gate('Physical formula traceable',snapshot.includes('.46 * causal')&&snapshot.includes('.20 * transmission')&&snapshot.includes('.18 * Math.max(0, gap)')&&snapshot.includes('sensorPenalty'),'Human documentation must remain grounded in executable score code.');
gate('State documentation grounded',score.includes("g.arming||45")&&score.includes("g.watch||25")&&score.includes("g.active||65"),'Documented thresholds must remain traceable to executable state gates.');

if(fail.length){console.error(`\nEconomist human-mode audit failed (${fail.length}):\n- ${fail.join('\n- ')}`);process.exit(1)}
console.log(`\nEconomist Human Mode audit OK · 14/14 gates`);
