import fs from 'node:fs/promises';

const html=await fs.readFile('index.html','utf8'),portfolio=await fs.readFile('portfolio.html','utf8'),failures=[];
const gate=(name,ok,why)=>{if(!ok)failures.push(`${name}: ${why}`);console.log(`${ok?'PASS':'FAIL'} · ${name}`)},pos=s=>html.indexOf(s);
gate('Decision hierarchy',pos('4 · Causal')>=0&&pos('5 · Pass 1')>pos('4 · Causal')&&pos('6 · Pass 2')>pos('5 · Pass 1')&&pos('7 · Final TX')>pos('6 · Pass 2')&&pos('8 · Market Vote')>pos('7 · Final TX')&&pos('9 · Crowd Phase')>pos('8 · Market Vote')&&pos('10 · Ranked Pool')>pos('9 · Crowd Phase'),'Expected Causal → P1 → P2 → Final TX → Market → Crowd → Ranked Pool');
gate('Broker simplicity',!html.includes('trading212.com')&&!/href=["'][^"']*212/i.test(html)&&html.includes('CURATED ✓'),'T212 must be a status, not a broker link');
gate('Adaptive pool visible',html.includes('5–10 visibles · Top 5 pie')&&html.includes('ranked_candidates'),'Dashboard must distinguish research/ranking pool from executable Top 5');
gate('Audit above fold',html.includes('auditBanner')&&html.includes('System audit')&&html.includes('audit-v3.json'),'Audit health must be visible without reading raw JSON');
gate('Per-mechanism audit',html.includes('Audit / retrieval')&&html.includes('retrieval_candidates'),'Dossier must expose mechanism search/pool health');
gate('Progressive disclosure',html.includes('<details class=company>')&&html.includes('<summary>'),'Company diagnostics stay collapsed');
gate('Three-metric card hierarchy',html.includes('<span>CAUSAL</span>')&&html.includes('<span>FINAL TX</span>')&&html.includes('<span>MARKET</span>'),'Cards keep causal/TX/market primary');
gate('Two-pass explainability',html.includes('PASS 1 · STRUCTURAL')&&html.includes('PASS 2 · FINANCIAL')&&html.includes('FINAL TX')&&!html.includes('weight_applied'),'Expose passes without implementation noise');
gate('Scout independent filter',html.includes("filter==='SCOUT'?x.scout?.eligible")&&html.includes('ALPHA'),'Scout must remain independently filterable from Alpha');
gate('Priced-in warning',html.includes('DO NOT CHASE')&&html.includes('priced-in'),'Late timing warning required');
gate('Capital not chatter',html.includes('Wisdom of capital')&&!html.includes('Reddit sentiment'),'Crowd means capital behavior');
gate('Modal semantics',html.includes('role="dialog"')&&html.includes('aria-modal="true"')&&html.includes('aria-label="Cerrar dossier"'),'Modal semantics required');
gate('Keyboard activation',html.includes("e.key==='Enter'||e.key===' '")&&html.includes("if(e.key==='Escape')closeModal()"),'Keyboard support required');
gate('Visible focus',html.includes(':focus-visible'),'Keyboard focus visible');
gate('Reduced motion',html.includes('@media(prefers-reduced-motion:reduce)'),'Reduced-motion supported');
gate('Mobile collapse',html.includes('@media(max-width:900px)')&&html.includes('.passstrip{grid-template-columns:1fr}'),'Main dossier responsive');
gate('Dense data below fold',html.includes('WHY EACH COMPANY')&&html.includes('componentBars(t)'),'Detailed factors stay in dossier');
gate('Shadow navigation',html.includes('Shadow Portfolio ↗')&&portfolio.includes('← Mechanism Engine'),'Two surfaces cross-link');

gate('Portfolio mode obvious',portfolio.includes('SHADOW <span>SLEEVE</span>')&&portfolio.includes('LIVE EXECUTION = OFF'),'Portfolio must not resemble live terminal');
gate('Budget visible',portfolio.includes('$500 BUDGET')&&portfolio.includes('$80 MAX')&&portfolio.includes('6 SLOTS'),'Capital constraints visible');
gate('Protected position visible',portfolio.includes('SGMOQ 🔒')&&portfolio.includes('SGMOQ · LOCKED OUT'),'SGMOQ isolation visible');
gate('No-trade first class',portfolio.includes('Nada. Eso también es una decisión.')&&portfolio.includes('NO SETUP = NO TRADE'),'No trade is intentional');
gate('Regime and session visible',portfolio.includes('Market regime')&&portfolio.includes('Entry allowed')&&portfolio.includes('Session:'),'Regime/session auditable');
gate('T212 mode visible',portfolio.includes('CURATED SHADOW GATE ON')&&portfolio.includes('Official catalogue matched'),'Both curated/live broker modes explained');
gate('Portfolio audit visible',portfolio.includes('System audit')&&portfolio.includes('audit-v3.json'),'Shadow page must show audit verdict');
gate('Paper ledger visible',portfolio.includes('paper-portfolio.json')&&portfolio.includes('trade-journal.json'),'Explicit ledgers required');
gate('Portfolio mobile',portfolio.includes('@media(max-width:950px)'),'Portfolio responsive');
gate('Portfolio reduced motion',portfolio.includes('@media(prefers-reduced-motion:reduce)'),'Portfolio reduced motion');
if(failures.length){console.error(`\nUI/UX audit failed (${failures.length}):\n- ${failures.join('\n- ')}`);process.exit(1)}
console.log('\nGearWatch UI/UX audit OK · 28/28 gates');
