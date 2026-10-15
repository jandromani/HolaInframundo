// GearWatch V6 — read-only product shell. Public artifacts from GitHub; private theses only in localStorage.
// This file must not produce or execute brokerage orders.
const RAW='https://raw.githubusercontent.com/jandromani/HolaInframundo/master/';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanUrl=v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)?u.href:null}catch{return null}};
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v).toLocaleString('es-ES',{maximumFractionDigits:d}):'—';
const date=v=>{try{return v?new Date(v).toLocaleString('es-ES',{dateStyle:'medium',timeStyle:'short'}):'Fecha desconocida'}catch{return 'Fecha desconocida'}};
const tag=(v,t='')=>'<span class="tag '+t+'">'+esc(v)+'</span>';
const sourceLink=e=>{const href=cleanUrl(e.source_url);return href?'<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(e.domain||'Fuente original')+' ↗</a>':'Fuente no verificable'};
const data={home:null,world:null,companies:null,history:null,shock:null,mode:'world',fallback:false};
async function read(path){
 const r=await fetch(RAW+path+'?v='+Date.now(),{cache:'no-store'});
 if(!r.ok)throw new Error(path+' HTTP '+r.status);
 return r.json();
}
function slugTitle(id){return String(id||'').replaceAll('_',' ').toLowerCase().replace(/^./,x=>x.toUpperCase())}
function selectShock(id){if(!data.home)return;data.shock=data.home.shocks.find(s=>s.id===id)||data.home.shocks[0]||null}
function freshness(){const h=data.home;const f=$('#freshness');if(!h){f.textContent='Sin datos';return;}f.textContent=(data.fallback?'MODO COMPATIBILIDAD V5 · ':'')+'Datos del '+date(h.as_of)+' · Run '+(h.run_id||'sin identificación');}
function paragraphList(rows,empty='Sin evidencia verificable en este snapshot'){
 return rows?.length?'<ul class="list">'+rows.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<div class="empty">'+esc(empty)+'</div>';
}
function shockCard(s){
 return '<button type="button" class="card mini" data-select-shock="'+esc(s.id)+'" data-target-view="transmission" style="text-align:left;width:100%">'+
  '<div class="ey">'+esc(s.group||'SHOCK')+'</div><h3>'+esc(s.title)+'</h3>'+
  '<p class="sub">'+esc(s.subtitle||'')+'</p>'+
  '<div class="row">'+tag('Índice investigación '+num(s.priority_score), 'warn')+
  '<span class="tiny">'+esc(s.evidence_quality||'SIN CALIFICAR')+'</span></div></button>';
}
function makeWorld(){
 const h=data.home;if(!h||!h.shocks?.length){$('#world').innerHTML='<div class="empty">No hay shocks de V6 disponibles. El motor aún no ha publicado un run compatible.</div>';return;}
 const s=h.shocks.find(x=>x.id===h.homepage?.primary)||h.shocks[0];
 const secondary=(h.homepage?.secondary||[]).map(id=>h.shocks.find(x=>x.id===id)).filter(Boolean).slice(0,2);
 const world=data.world?.world_variables||{};
 const drivers=(s.drivers||[]).slice(0,4);
 const physical=drivers.map(d=>world[d.mechanism_id]).filter(Boolean);
 const events=physical.flatMap(d=>d.events||[]).sort((a,b)=>Date.parse(b.effective_at||b.published_at||b.recorded_at||0)-Date.parse(a.effective_at||a.published_at||a.recorded_at||0)).slice(0,8);
 let html='<div class="stack"><div class="cols"><article class="card primary">'+
  '<div class="row"><span class="ey">SHOCK PRINCIPAL · '+esc(s.group)+'</span>'+tag(s.evidence_quality||'CALIDAD PENDIENTE',s.evidence_quality?.includes('RECENT')?'good':'warn')+'</div>'+
  '<h2>'+esc(s.title)+'</h2><p>'+esc(s.subtitle)+'</p>'+
  '<div class="grid3" style="margin:20px 0">'+
   '<div><div class="metric">'+num(s.causal_max)+'</div><div class="metric-caption">Máximo índice causal interno · no probabilidad</div></div>'+
   '<div><div class="metric">'+num(s.observed_mechanisms)+'</div><div class="metric-caption">Mecanismos con puntuación ≥25</div></div>'+
   '<div><div class="metric">'+(s.market_priced_in_proxy==null?'—':num(s.market_priced_in_proxy))+'</div><div class="metric-caption">Proxy de reacción bursátil · no % de verdad</div></div>'+
  '</div><div class="row"><button class="btn btn-primary" data-select-shock="'+esc(s.id)+'" data-target-view="transmission">Explorar transmisión →</button>'+
  '<span class="tiny">Prioridad interna '+num(s.priority_score)+'/100</span></div>'+
 '</article><aside class="card"><div class="ey">QUÉ SIGNIFICA</div><h3>Hechos, no sólo titulares</h3>'+
 '<p>GearWatch separa documentos recientes, persistencia histórica y mediciones físicas. Una puntuación alta no demuestra por sí sola un cierre de rutas, escasez ni beneficio empresarial.</p>'+
 '<div class="bullet"><strong>Variable líder</strong><span>'+esc(slugTitle(s.lead_mechanism))+'</span></div>'+
 '<div class="bullet"><strong>Próximo dato necesario</strong><span>'+esc(s.next_checks?.[0]||'Esperar una nueva medición verificable')+'</span></div>'+
 '<div class="bullet"><strong>Qué lo refutaría</strong><span>'+esc(s.falsifiers?.[0]||'Falta definir falsador')+'</span></div>'+
 '</aside></div>'+
 '<div><div class="row" style="margin:4px 0 12px"><div><div class="ey">DOS HISTORIAS MÁS</div><h2 style="margin:4px 0">No perder de vista</h2></div></div><div class="grid2">'+secondary.map(shockCard).join('')+'</div></div>'+
 '<div class="cols"><div class="card"><div class="ey">EVIDENCIA MÁS RECIENTE DEL EXPEDIENTE</div><h3>Qué podemos verificar</h3>'+
 (events.length?'<ul class="list">'+events.map(e=>'<li><div>'+esc(e.claim)+'</div><div class="tiny">'+date(e.effective_at||e.published_at)+' · '+sourceLink(e)+' · '+esc(e.event_time_quality||'UNKNOWN')+'</div></li>').join('')+'</ul>':
 '<div class="empty">No hay hechos publicados verificables en el ledger público de este shock. Consulta el laboratorio y el estado de los sensores.</div>')+
 '</div><div class="card"><div class="ey">SIGUIENTE CICLO</div><h3>Qué observar</h3>'+paragraphList(s.next_checks)+
 '<div class="line"></div><div class="ey">SEÑALES DE REVISIÓN</div>'+paragraphList(s.falsifiers)+'</div></div></div>';
 $('#world').innerHTML=html;
}
function activeShock(){return data.shock||data.home?.shocks?.[0]||null}
function makeGraph(shock){
 const nodes=(shock.drivers||[]).slice(0,4);
 const pieces=(shock.companies||[]).slice(0,6);
 return '<div class="graph"><div class="graph-stage">'+
 '<div class="graph-layer"><button type="button" class="node gold" data-open-shock="'+esc(shock.id)+'"><strong>'+esc(shock.title)+'</strong><small>Shock raíz · abrir expediente</small></button></div>'+
 '<div class="arrow">↓ PROPAGACIÓN HIPOTÉTICA ↓</div>'+
 '<div class="graph-layer">'+nodes.map(d=>'<button class="node" type="button" data-open-mechanism="'+esc(d.mechanism_id)+'">'+esc(slugTitle(d.mechanism_id))+'<small>Señal '+num(d.score)+' · '+esc(d.freshness)+'</small></button>').join('')+'</div>'+
 '<div class="arrow">↓ CAPTURA ECONÓMICA (POR VALIDAR) ↓</div>'+
 '<div class="graph-layer">'+pieces.map(c=>'<button class="node out" type="button" data-open-company="'+esc(c.ticker)+'"><strong>'+esc(c.ticker)+'</strong><small>Transmisión modelo '+num(c.transmission_score)+'</small></button>').join('')+'</div>'+
 '</div></div>';
}
function makeTransmission(){
 const s=activeShock();
 if(!s){$('#transmission').innerHTML='<div class="empty">Esperando shocks con evidencia.</div>';return;}
 const all=data.home.shocks;
 $('#transmission').innerHTML='<div class="stack"><div class="card">'+
 '<div class="map-head"><div><div class="ey">02 · TRANSMISIÓN</div><h2>Del hecho físico a la empresa</h2><p class="sub">Selecciona una narrativa y pulsa cualquier nodo para ver fuentes, limitaciones y economía.</p></div><div style="min-width:230px"><label for="shock-select">Shock que investigamos</label><select id="shock-select">'+all.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===s.id?'selected':'')+'>'+esc(x.title)+'</option>').join('')+'</select></div></div>'+
 makeGraph(s)+'</div><div class="cols"><div class="card"><div class="ey">MECANISMOS / DOMINÓS</div><h3>Lo que conecta el sistema</h3>'+
 ((s.transmission_hypotheses||[]).length?'<ul class="list">'+s.transmission_hypotheses.map(e=>'<li><strong>'+esc(slugTitle(e.from))+' → '+esc(slugTitle(e.to))+'</strong><div class="tiny">Hipótesis · retardos previstos '+esc((e.expected_lag_runs||[]).join(', '))+' ciclos; no relación causal demostrada</div></li>').join('')+'</ul>':
 '<div class="empty">Todavía no existen aristas configuradas entre las variables de este shock. No se inventarán conexiones.</div>')+
 '<h3 style="margin-top:24px">Qué confirmaría / invalidaría</h3>'+paragraphList(s.next_checks)+
 '<div class="line"></div>'+paragraphList(s.falsifiers)+'</div>'+
 '<div class="card"><div class="ey">CAPTURA ECONÓMICA</div><h3>Empresas bajo la lupa</h3>'+
 '<p class="sub">El ajuste sectorial no equivale a sensibilidad de EBITDA ni a recomendación. Pulsa una compañía para comprobarlo.</p>'+
 '<div class="pieces">'+(s.companies||[]).slice(0,12).map(c=>'<button class="piece" type="button" data-open-company="'+esc(c.ticker)+'"><strong>'+esc(c.ticker)+'</strong><small>'+esc(slugTitle(c.mechanism_id))+'</small><small>Transmisión estructural '+num(c.transmission_score)+'</small></button>').join('')+'</div></div></div></div>';
}
const POSKEY='gearwatch.v6.positions.local';
function readPositions(){try{const raw=JSON.parse(localStorage.getItem(POSKEY)||'{}');return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}}catch{return {}}}
function savePositions(v){localStorage.setItem(POSKEY,JSON.stringify(v))}
function positionCard(symbol){
 const p=readPositions()[symbol]||{};
 const exposures=data.companies?.by_ticker?.[symbol]||[];
 const best=exposures[0]||{};
 return '<div class="card mini" style="cursor:default"><div class="row"><h3>'+esc(symbol)+'</h3>'+tag(best.capture_status||'EXPOSICIÓN POR VALIDAR','warn')+'</div>'+
 '<div class="sub">'+esc(slugTitle(best.mechanism_id||'Sin datos empresariales'))+'</div>'+
 '<div class="grid2" style="margin:14px 0"><div><div class="metric">'+(p.amount?num(p.amount,2)+' €':'—')+'</div><div class="metric-caption">Importe introducido localmente</div></div>'+
 '<div><div class="metric">'+(best.market?.price==null?'—':num(best.market.price,2))+'</div><div class="metric-caption">Precio en snapshot · divisa del ticker</div></div></div>'+
 '<div class="sub">'+esc(best.economics?.channel||'Falta un puente de ingresos verificado')+'</div>'+
 '<button class="btn" data-open-company="'+esc(symbol)+'" style="margin-top:12px">Abrir análisis empresarial →</button></div>';
}
function makeTheses(){
 const positions=readPositions();const symbols=[...new Set(['GTE','PSHG',...Object.keys(positions)])];
 $('#theses').innerHTML='<div class="stack"><div class="cols"><div class="card"><div class="ey">03 · MIS TESIS</div>'+
 '<h2>El resultado importa más que el relato.</h2>'+
 '<p>Seguimos tus ideas, no sólo las noticias. ¿Acertó la causa raíz? ¿La empresa capturó realmente el cambio? ¿El mercado pagó por ello?</p>'+
 '<div class="notice">Posiciones reales: sólo se almacenan en este navegador. No tenemos sincronización bancaria ni precios ejecutados confirmados. Las cifras del motor son escenarios, no operaciones.</div>'+
 '<div class="grid2" style="margin-top:15px">'+symbols.map(positionCard).join('')+'</div></div>'+
 '<aside class="card"><div class="ey">ACTUALIZAR MI POSICIÓN</div><h3>Seguimiento privado local</h3>'+
 '<form id="positions-form"><div class="field"><label for="pos-symbol">Ticker</label><input id="pos-symbol" name="symbol" maxlength="14" value="GTE" required></div>'+
 '<div class="field"><label for="pos-amount">Importe invertido (€)</label><input id="pos-amount" name="amount" type="number" min="0" step="0.01" placeholder="Ej.: 700" required></div>'+
 '<div class="field"><label for="pos-entry">Precio medio pagado (divisa cotización; opcional)</label><input id="pos-entry" name="entry" type="number" min="0" step="0.0001" placeholder="Permite calcular retorno aproximado"></div>'+
 '<button type="submit" class="btn btn-primary">Guardar en este navegador</button></form>'+
 '<p class="tiny">Para calcular P&L real se necesitan unidades, operaciones, divisa y comisiones; no lo inventaremos a partir de importes. Borra datos locales desde la configuración del navegador.</p></aside></div>'+
 '<div class="card"><div class="ey">REPLAY / APRENDIZAJE</div><h3>¿Qué habríamos sabido antes del movimiento?</h3>'+
 '<div id="replay"><p class="sub">Cargando checkpoints históricos disponibles…</p></div></div></div>';
 makeReplay();
}
function makeReplay(){
 const el=$('#replay');if(!el)return;
 const arr=data.history?.runs||[];
 if(!arr.length){el.innerHTML='<div class="empty">Aún no hay checkpoints V6. El historial V5 continúa disponible en el laboratorio.</div>';return}
 el.innerHTML='<div class="sub">Cada checkpoint conserva la evaluación de su momento. El historial V6 comienza con la primera publicación; no es un backfill inventado del 5 de octubre.</div>'+
 '<div style="overflow:auto"><table class="data-table"><thead><tr><th>Fecha</th><th>Shock líder</th><th>Prioridad interna</th></tr></thead><tbody>'+
 arr.slice(-12).reverse().map(p=>{const s=[...(p.shocks||[])].sort((a,b)=>b.priority_score-a.priority_score)[0];return '<tr><td>'+date(p.as_of)+'</td><td>'+esc(s?.id||'—')+'</td><td>'+num(s?.priority_score)+'</td></tr>'}).join('')+
 '</tbody></table></div>';
}
function makeLab(){
 const h=data.home?.health||{},coverage=h.pricing_coverage||{},src=h.stale_or_unavailable_sources||[];
 $('#lab-body').innerHTML='<div class="grid2"><div><div class="ey">INTEGRIDAD</div><h3>Datos y cobertura</h3>'+
 '<ul class="list"><li>Run: '+esc(data.home?.run_id||'NO IDENTIFICADO')+'</li><li>Generado: '+date(data.home?.generated_at||data.home?.as_of)+'</li>'+
 '<li>Integridad: '+esc(h.source_integrity||'NO DISPONIBLE')+'</li>'+
 '<li>Fuentes configuradas: '+num(coverage.configured_sources)+'</li>'+
 '<li>Fuentes con score válido: '+num(coverage.scored_sources)+'</li></ul></div>'+
 '<div><div class="ey">SENSORES CIEGOS</div><h3>No confundir falta de datos con normalidad</h3>'+
 (src.length?'<ul class="list">'+src.slice(0,15).map(x=>'<li>'+esc(x.source)+' · '+esc(x.status)+' <span class="tiny">'+esc(x.error||'')+'</span></li>').join('')+'</ul>':
 '<div class="empty">No hay información detallada sobre sensores.</div>')+'</div></div>'+
 '<div class="line"></div><div class="row"><a href="/legacy/v5.html">Abrir V5 · laboratorio con los 26 mecanismos ↗</a><a href="/portfolio.html">Abrir paper portfolio ↗</a></div>'+
 '<p class="tiny">Los scores son indicadores internos de investigación. No son probabilidades calibradas ni mediciones de rentabilidad esperada. Los estados físicos exigen fuentes primarias observables.</p>';
}
function evidenceDetails(id){
 const m=data.world?.world_variables?.[id];if(!m)return '<p>Sin ledger verificable para este mecanismo.</p>';
 return '<div class="grid2"><div><strong>Estado causal</strong><p>'+esc(m.causal_state)+' · '+num(m.causal_score)+'/100</p></div>'+
 '<div><strong>Estado físico medido</strong><p>'+esc(m.physical_state)+'</p></div>'+
 '<div><strong>Calidad de evidencia</strong><p>'+esc(m.physical_evidence_status)+'</p></div>'+
 '<div><strong>Frescura</strong><p>'+esc(m.observation_freshness)+'</p></div></div>'+
 '<p class="notice">'+esc(m.quality?.warning||'El mecanismo causal no verifica por sí mismo un hecho físico.')+'</p>'+
 '<h3>Fuentes archivadas</h3>'+((m.events||[]).length?'<ul class="list">'+m.events.slice(0,24).map(e=>'<li>'+esc(e.claim)+'<div class="tiny">'+date(e.effective_at||e.published_at)+' · '+sourceLink(e)+'</div></li>').join('')+'</ul>':
 '<div class="empty">No se han publicado eventos originales verificables en este expediente.</div>');
}
function companyDetails(ticker){
 const rows=data.companies?.by_ticker?.[ticker]||[];
 if(!rows.length)return '<div class="empty">No hay ficha económica verificable en el último snapshot. Evitamos inferir ingresos sólo por el ticker.</div>';
 return rows.slice(0,3).map(r=>{
 const e=r.economics||{},q=r.data_quality||{};
 return '<div class="card" style="margin:12px 0"><div class="row"><strong>'+esc(slugTitle(r.mechanism_id))+'</strong>'+tag(r.capture_status,'warn')+'</div>'+
 '<p>'+esc(e.channel||'Canal de ingresos aún no especificado')+'</p>'+
 '<div class="grid3"><div><div class="metric">'+num(r.transmission_score)+'</div><div class="metric-caption">Transmisión modelada</div></div>'+
 '<div><div class="metric">'+num(r.risk_adjusted_score)+'</div><div class="metric-caption">Ajustada por riesgos</div></div>'+
 '<div><div class="metric">'+(e.fcf_margin==null?'—':num(e.fcf_margin,1)+'%')+'</div><div class="metric-caption">Margen FCF histórico</div></div></div>'+
 '<h3>Puente económico</h3>'+paragraphList(e.bridge)+
 '<h3>Qué lo diluye</h3>'+paragraphList(e.diluters)+
 '<div class="line"></div><p class="tiny">Fundamentales: '+esc(q.fundamental)+' · Período '+esc(q.period_end||'desconocido')+
 ' · Broker: '+esc(q.broker_label)+' · Cotización snapshot '+num(r.market?.price,2)+'</p>'+
 '<p class="notice">'+esc(r.capture_warning)+'</p></div>';
 }).join('');
}
function shockDetails(id){
 const s=data.home?.shocks?.find(x=>x.id===id);if(!s)return '<div class="empty">Shock no encontrado</div>';
 return '<p>'+esc(s.subtitle)+'</p><div class="notice">'+esc(s.warning)+'</div>'+
 '<h3>Mecanismos</h3>'+paragraphList(s.drivers.map(d=>slugTitle(d.mechanism_id)+' · índice '+d.score))+
 '<h3>Hipótesis que vigilar</h3>'+paragraphList(s.next_checks)+'<h3>Falsadores</h3>'+paragraphList(s.falsifiers);
}
let lastFocus=null;
function openModal(type,id){
 lastFocus=document.activeElement;
 $('#modal-title').textContent=(type==='company'?'Compañía '+id:type==='shock'?'Shock: '+(data.home?.shocks?.find(s=>s.id===id)?.title||id):slugTitle(id));
 $('#detail').innerHTML=type==='company'?companyDetails(id):type==='shock'?shockDetails(id):evidenceDetails(id);
 $('#modal').classList.add('open');$('#modal').setAttribute('aria-hidden','false');$('.sheet').classList.remove('wide');$('#maximize').textContent='Maximizar';
 $('#close').focus();document.body.style.overflow='hidden';
}
function closeModal(){
 $('#modal').classList.remove('open');$('#modal').setAttribute('aria-hidden','true');
 document.body.style.overflow='';lastFocus?.focus?.();
}
function view(name){
 data.mode=name;
 for(const t of document.querySelectorAll('[data-view]'))t.setAttribute('aria-selected',String(t.dataset.view===name));
 for(const p of document.querySelectorAll('.panel'))p.classList.toggle('active',p.id===name);
}
function redraw(){freshness();makeWorld();makeTransmission();makeTheses();makeLab();view(data.mode);}
function fallbackFromV5(current,investment,config){
 const groups=config.groups||[],mechs=current.mechanisms||{};
 const shocks=groups.map(g=>{
 const drivers=(g.mechanism_ids||[]).filter(id=>mechs[id]).map(id=>({mechanism_id:id,score:mechs[id].score||0,freshness:'NOT_A_PRIMARY_MEASUREMENT'})).sort((a,b)=>b.score-a.score);
 const lead=drivers[0]?.mechanism_id;
 return {id:g.id,title:g.title,subtitle:g.subtitle,group:g.family,priority_score:drivers[0]?.score||0,
 causal_max:drivers[0]?.score||0,observed_mechanisms:drivers.filter(d=>d.score>=25).length,
 evidence_quality:'V5_CAUSAL_PROXY_ONLY',lead_mechanism:lead,drivers,market_priced_in_proxy:investment.strategies?.[lead]?.priced_in,
 companies:drivers.flatMap(d=>(investment.strategies?.[d.mechanism_id]?.top5||[]).slice(0,2).map(x=>({ticker:x.symbol,mechanism_id:d.mechanism_id,transmission_score:x.transmission?.score}))).slice(0,12),
 transmission_hypotheses:[],next_checks:g.next_checks,falsifiers:g.falsifiers,
 warning:'MODO COMPATIBILIDAD: faltan archivos V6. Proxies causales no equivalen a estado físico.'};
 }).sort((a,b)=>b.priority_score-a.priority_score);
 const by_ticker={};for(const [id,s] of Object.entries(investment.strategies||{}))for(const x of s.top_candidates||[]){if(!x.symbol)continue;(by_ticker[x.symbol]??=[]).push({
 symbol:x.symbol,mechanism_id:id,transmission_score:x.transmission?.score,rank_score:x.rank_score,
 economics:{channel:x.transmission?.path?.earnings_channel,bridge:x.transmission?.path?.bridge||[],diluters:x.transmission?.path?.diluters||[],
 fcf_margin:x.transmission?.financials?.fcf_margin},data_quality:{fundamental:x.fundamental_quality,period_end:x.fundamental?.period_end,
 broker_label:x.broker_verified?'BROKER_VERIFIED':'UNVERIFIED_CURATED_UNIVERSE'},market:{price:x.market?.price},capture_status:'EXPOSURE_MODEL_ONLY',
 capture_warning:'V5 fallback. Sensibilidad real de caja no verificada.'
 });}
 return {home:{schema_version:'6.0.0-FALLBACK',run_id:current.run_id,as_of:current.updated_at,
 homepage:{primary:shocks[0]?.id,secondary:shocks.slice(1,3).map(s=>s.id)},shocks,health:{source_integrity:'FALLBACK_V5',pricing_coverage:{}}},companies:{by_ticker},world:{world_variables:{}}};
}
async function init(){
 try{
  const [home,companies,world,history]=await Promise.allSettled([
   read('data/v6/homepage.json'),read('data/v6/companies.json'),
   read('data/v6/world-current.json'),read('data/v6/history/checkpoints.json')]);
  if(home.status==='fulfilled'&&companies.status==='fulfilled'&&world.status==='fulfilled'&&
    home.value.run_id===companies.value.run_id&&home.value.run_id===world.value.run_id){
   data.home=home.value;data.companies=companies.value;data.world=world.value;
  }else{
   const [curr,inv,conf]=await Promise.all([read('data/current.json'),read('data/investment-layer.json'),read('config/shock-groups.v6.json')]);
   Object.assign(data,fallbackFromV5(curr,inv,conf));data.fallback=true;
  }
  data.history=history.status==='fulfilled'?history.value:{runs:[]};
  selectShock(data.home?.homepage?.primary);
  redraw();
 }catch(e){
  console.error('GearWatch V6 load failed',e);
  $('#freshness').textContent='Fallo de carga · conserva acceso a V5';
  $('#world').innerHTML='<div class="notice">No se pudo recuperar un snapshot íntegro. <a href="/legacy/v5.html">Abrir la V5</a> o consultar el último estado del repositorio. No se mostrarán datos inventados.</div>';
 }
}
document.addEventListener('click',ev=>{
 const t=ev.target.closest('button');if(!t)return;
 if(t.dataset.view){view(t.dataset.view);return}
 if(t.dataset.selectShock){selectShock(t.dataset.selectShock);makeTransmission();if(t.dataset.targetView)view(t.dataset.targetView);return}
 if(t.dataset.openMechanism){openModal('mechanism',t.dataset.openMechanism);return}
 if(t.dataset.openCompany){openModal('company',t.dataset.openCompany);return}
 if(t.dataset.openShock){openModal('shock',t.dataset.openShock);return}
 if(t.id==='close'){closeModal();return}
 if(t.id==='maximize'){$('.sheet').classList.toggle('wide');t.textContent=$('.sheet').classList.contains('wide')?'Restaurar':'Maximizar';return}
});
document.addEventListener('change',ev=>{if(ev.target.id==='shock-select'){selectShock(ev.target.value);makeTransmission()}});
document.addEventListener('submit',ev=>{
 if(ev.target.id!=='positions-form')return;
 ev.preventDefault();const fd=new FormData(ev.target),symbol=String(fd.get('symbol')||'').trim().toUpperCase().replace(/[^A-Z0-9.-]/g,'').slice(0,14);
 const amount=Number(fd.get('amount')),entry=Number(fd.get('entry'));
 if(!symbol||!Number.isFinite(amount)||amount<0)return;
 const positions=readPositions();
 if(amount===0)delete positions[symbol];else positions[symbol]={amount,entry:Number.isFinite(entry)&&entry>0?entry:null};
 savePositions(positions);makeTheses();
});
document.addEventListener('keydown',ev=>{
 if(ev.key==='Escape'&&$('#modal').classList.contains('open'))closeModal();
 if(ev.key==='Tab'&&$('#modal').classList.contains('open')){
  const focus=[...$('#modal').querySelectorAll('button,a[href],input')].filter(x=>!x.disabled);
  if(!focus.length)return;const first=focus[0],last=focus.at(-1);
  if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus()}
  else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus()}
 }
});
$('#modal').addEventListener('click',ev=>{if(ev.target.id==='modal')closeModal()});
init();
