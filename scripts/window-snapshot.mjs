import fs from 'node:fs/promises';

const read = async (path, fallback) => JSON.parse(await fs.readFile(path, 'utf8').catch(() => JSON.stringify(fallback)));
const WINDOW = await read('data/event-window.json', { groups: [] });
const CURRENT = await read('data/current.json', { mechanisms: {} });
const INVESTMENT = await read('data/investment-layer.json', { strategies: {} });
const MARKET = await read('data/market.json', { metrics: {} });
const PRICING = await read('data/pricing-sensors.json', { observations: {} });
const PROD = await read('data/production-health.json', {});
const BRIEF = await read('data/daily-briefing.json', {});
const HISTORY_PATH = 'data/history/window-snapshots.json';
const HISTORY = await read(HISTORY_PATH, { version: '1.0.0', window_id: WINDOW.id, snapshots: [] });

const now = new Date();
const recordingStart = Date.parse(WINDOW.recording_start || WINDOW.start || '');
const recordingEnd = Date.parse(WINDOW.recording_end || WINDOW.end || '');
if ((Number.isFinite(recordingStart) && now.getTime() < recordingStart) || (Number.isFinite(recordingEnd) && now.getTime() > recordingEnd)) {
  console.log(`window snapshot: outside recording period ${WINDOW.recording_start || WINDOW.start} → ${WINDOW.recording_end || WINDOW.end}`);
  process.exit(0);
}
const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, Number(x) || 0));
const round = (x, d = 1) => Number(Number(x || 0).toFixed(d));
const mean = values => {
  const a = values.map(Number).filter(Number.isFinite);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
};
const strategy = id => INVESTMENT.strategies?.[id] || {};
const mechanism = id => CURRENT.mechanisms?.[id] || null;
const priced = (id, m) => clamp(strategy(id)?.priced_in ?? m?.crowd?.priced_in);
const symbols = id => (strategy(id)?.top5 || strategy(id)?.top_candidates || []).map(x => x.symbol).filter(Boolean);

function mechanismRow(id) {
  const m = mechanism(id);
  if (!m) return null;
  const s = strategy(id);
  const causal = clamp(m.score);
  const pricedIn = priced(id, m);
  const gap = causal - pricedIn;
  const delta = Number(m.score_delta || 0);
  const marketReturns = symbols(id).map(t => Number(MARKET.metrics?.[t]?.ret20)).filter(Number.isFinite);
  const ret20 = marketReturns.length ? mean(marketReturns) : null;
  const transmission = clamp(s.transmission_score);
  const timing = clamp(s.timing_score);
  const freshness = clamp(50 + delta * 3);
  let pressure = .46 * causal + .20 * transmission + .18 * Math.max(0, gap) + .10 * freshness + .06 * timing;
  if (s.crowd?.block_chase) pressure -= 8;
  return {
    id,
    label: m.label || id,
    state: m.state || 'UNKNOWN',
    causal: round(causal),
    priced_in: round(pricedIn),
    gap: round(gap),
    delta: round(delta),
    transmission: round(transmission),
    timing: round(timing),
    pressure: round(clamp(pressure)),
    ret20: Number.isFinite(ret20) ? round(ret20, 2) : null,
    symbols: symbols(id).slice(0, 5),
    verifier: m.verifier?.verdict || null
  };
}

function groupSnapshot(group) {
  const rows = (group.mechanisms || []).map(mechanismRow).filter(Boolean).sort((a, b) => b.pressure - a.pressure);
  const focus = rows.slice(0, Math.min(2, rows.length));
  return {
    id: group.id,
    label: group.label,
    icon: group.icon || '⚙',
    pressure: round(mean(focus.map(x => x.pressure))),
    causal: round(mean(focus.map(x => x.causal))),
    priced_in: round(mean(focus.map(x => x.priced_in))),
    gap: round(mean(focus.map(x => x.gap))),
    ret20: focus.some(x => Number.isFinite(x.ret20)) ? round(mean(focus.map(x => x.ret20).filter(Number.isFinite)), 2) : null,
    leaders: rows.slice(0, 4).map(x => x.id)
  };
}

function sensorSummary() {
  const obs = Object.values(PRICING.observations || {});
  const ok = obs.filter(x => x?.status === 'OK').length;
  const warning = obs.filter(x => x?.status && x.status !== 'OK').length;
  const blocks = Object.entries(PROD.pricing?.blocks || {}).flatMap(([name, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return values.some(x => x !== 'OK') ? [{ name, status: values.join('/') }] : [];
  });
  const degraded = [...obs.filter(x => x?.status && x.status !== 'OK').map(x => ({ name: x.source || x.metric || 'sensor', status: x.status })), ...blocks];
  const unique = [];
  const seen = new Set();
  for (const item of degraded) {
    const key = `${item.name}|${item.status}`;
    if (!seen.has(key)) { seen.add(key); unique.push(item); }
  }
  const confidence = obs.length ? clamp(100 * ok / obs.length) : 0;
  return { ok, warning, total: obs.length, confidence: round(confidence), degraded: unique.slice(0, 12) };
}

const groups = (WINDOW.groups || []).map(groupSnapshot);
const allMechanismIds = [...new Set((WINDOW.groups || []).flatMap(g => g.mechanisms || []))];
const mechanisms = Object.fromEntries(allMechanismIds.map(id => [id, mechanismRow(id)]).filter(([, row]) => row));
const sensors = sensorSummary();
const groupPressure = mean(groups.map(g => g.pressure));
const groupCausal = mean(groups.map(g => g.causal));
const groupPriced = mean(groups.map(g => g.priced_in));
const sensorPenalty = (100 - sensors.confidence) * .12;
const shockPressure = clamp(groupPressure - sensorPenalty);
const previous = HISTORY.snapshots?.at(-1) || null;

const deterministic = {
  shock_pressure: round(shockPressure),
  causal: round(groupCausal),
  priced_in: round(groupPriced),
  gap: round(groupCausal - groupPriced),
  sensor_confidence: round(sensors.confidence),
  delta_3h: previous ? round(shockPressure - Number(previous.composite?.shock_pressure || 0)) : 0,
  delta_semantic: previous ? round(shockPressure - Number(previous.judge?.semantic_pressure ?? previous.composite?.shock_pressure ?? 0)) : 0
};

const fallbackJudge = {
  model: 'deterministic-fallback',
  semantic_pressure: deterministic.shock_pressure,
  confidence: Math.round(deterministic.sensor_confidence),
  direction: deterministic.delta_3h > 3 ? 'ACCELERATING' : deterministic.delta_3h < -3 ? 'COOLING' : 'STABLE',
  headline: `Window checkpoint: presión ${Math.round(deterministic.shock_pressure)}/100`,
  summary: 'Lectura determinista de los grupos causales, descuento de mercado y salud de sensores.',
  checkpoint_label: 'Checkpoint determinista',
  drivers: groups.slice().sort((a, b) => b.pressure - a.pressure).slice(0, 3).map(g => `${g.label}: ${Math.round(g.pressure)}/100`),
  contradictions: sensors.degraded.slice(0, 3).map(x => `${x.name}: ${x.status}`),
  watch_next: groups.slice().sort((a, b) => b.gap - a.gap).slice(0, 3).map(g => `${g.label}: gap ${Math.round(g.gap)}`)
};

const judgeSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    semantic_pressure: { type: 'number', minimum: 0, maximum: 100 },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    direction: { type: 'string', enum: ['ACCELERATING', 'STABLE', 'COOLING', 'MIXED'] },
    headline: { type: 'string' },
    summary: { type: 'string' },
    checkpoint_label: { type: 'string' },
    drivers: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    contradictions: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    watch_next: { type: 'array', items: { type: 'string' }, maxItems: 5 }
  },
  required: ['semantic_pressure', 'confidence', 'direction', 'headline', 'summary', 'checkpoint_label', 'drivers', 'contradictions', 'watch_next']
};

function extractOutputText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) if (typeof content.text === 'string') return content.text;
  }
  return '';
}

async function openAIJudge() {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key) return fallbackJudge;
  const model = process.env.OPENAI_WINDOW_MODEL || 'gpt-5.6-luna';
  const payload = {
    model,
    reasoning: { effort: 'low' },
    max_output_tokens: 1200,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: 'Eres el juez de checkpoints de GearWatch. Resume sólo cambios observables en los datos. No inventes noticias, no des órdenes de compra/venta y no uses astrología como evidencia causal. semantic_pressure es una lectura semántica separada del score determinista.' }] },
      { role: 'user', content: [{ type: 'input_text', text: `VENTANA=${JSON.stringify({id:WINDOW.id,start:WINDOW.start,core_start:WINDOW.core_start,core_end:WINDOW.core_end,end:WINDOW.end})}\nAHORA=${JSON.stringify({composite:deterministic,groups,mechanisms,sensors,production:{status:PROD.status,judge:PROD.judge},daily_briefing:{headline:BRIEF.headline,blindspots:BRIEF.blindspots,watch_today:BRIEF.watch_today}})}\nANTERIOR=${JSON.stringify(previous ? {timestamp:previous.timestamp,composite:previous.composite,groups:previous.groups,judge:previous.judge,sensors:previous.sensors} : null)}\nDescribe qué ha ganado o perdido fuerza desde el checkpoint anterior y dónde divergen causalidad, mercado y sensores.` }] }
    ],
    text: { format: { type: 'json_schema', name: 'gearwatch_window_checkpoint', strict: true, schema: judgeSchema } }
  };
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text.slice(0, 500)}`);
    const parsed = JSON.parse(text);
    const output = JSON.parse(extractOutputText(parsed) || '{}');
    return { model: parsed.model || model, response_id: parsed.id || null, ...output };
  } catch (error) {
    return { ...fallbackJudge, error: String(error?.message || error) };
  }
}

const judge = await openAIJudge();
const snapshot = {
  timestamp: now.toISOString(),
  window_id: WINDOW.id,
  run_id: CURRENT.run_id || null,
  source_updated_at: CURRENT.updated_at || null,
  composite: deterministic,
  groups,
  mechanisms,
  sensors,
  production: { status: PROD.status || 'UNKNOWN', judge: PROD.judge?.status || 'UNKNOWN' },
  judge
};

const snapshots = [...(HISTORY.snapshots || [])];
const last = snapshots.at(-1);
if (last && Math.abs(Date.parse(snapshot.timestamp) - Date.parse(last.timestamp)) < 45 * 60 * 1000) snapshots[snapshots.length - 1] = snapshot;
else snapshots.push(snapshot);
while (snapshots.length > 1200) snapshots.shift();

await fs.mkdir('data/history', { recursive: true });
await fs.writeFile(HISTORY_PATH, JSON.stringify({
  version: '1.1.0',
  window_id: WINDOW.id,
  generated_at: now.toISOString(),
  cadence_hours: 3,
  snapshots
}, null, 2) + '\n');
console.log(`window snapshot: ${snapshot.timestamp} pressure=${snapshot.composite.shock_pressure} semantic=${snapshot.judge.semantic_pressure} snapshots=${snapshots.length}`);
