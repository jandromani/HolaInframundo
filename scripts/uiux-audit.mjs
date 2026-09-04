import fs from 'node:fs/promises';

const html=await fs.readFile('index.html','utf8');
const portfolio=await fs.readFile('portfolio.html','utf8');
const failures=[];
const gate=(name,ok,why)=>{if(!ok)failures.push(`${name}: ${why}`);console.log(`${ok?'PASS':'FAIL'} · ${name}`)};
const pos=s=>html.indexOf(s);

gate('Decision hierarchy',pos('4 · Causal')>=0&&pos('5 · Pass 1')>pos('4 · Causal')&&pos('6 · Pass 2')>pos('5 · Pass 1')&&pos('7 · Final TX')>pos('6 · Pass 2')&&pos('8 · Market Vote')>pos('7 · Final TX')&&pos('9 · Crowd Phase')>pos('8 · Market Vote')&&pos('10 · Top 5')>pos('9 · Crowd Phase'),'Expected Causal → Pass 1 → Pass 2 → Final TX → Market → Crowd Phase → Top 5 ordering');
gate('Broker simplicity',!html.includes('trading212.com')&&!/href=["'][^"']*212/i.test(html)&&html.includes('T212 ✓'),'Trading 212 should be a curated availability flag, never a runtime link');
gate('Progressive disclosure',html.includes('<details class=company>')&&html.includes('<summary>'),'Per-company diagnostics must stay collapsed until requested');
gate('Three-metric card hierarchy',html.includes('<span>CAUSAL</span>')&&html.includes('<span>FINAL TX</span>')&&html.includes('<span>MARKET</span>'),'Mechanism cards must keep three primary decision metrics before diagnostics');
gate('Crowd stays secondary',html.includes('waveband')&&html.includes('priced ${n(c.priced_in)}%'),'Crowd timing belongs below the primary three-metric decision row, not above it');
gate('Two-pass explainability',html.includes('PASS 1 · STRUCTURAL')&&html.includes('PASS 2 · FINANCIAL')&&html.includes('FINAL TX')&&html.includes('weight_applied')===false,'UI must expose both passes and final result without leaking internal implementation noise');
gate('Scout is not Deploy',html.includes('SCOUT_WINDOW')&&html.includes('No equivale a Deploy')&&html.includes("filter==='SCOUT'?x.scout?.eligible"),'Scout Window must be visibly distinct and independently filterable');
gate('Priced-in warning',html.includes('DO NOT CHASE')&&html.includes('priced-in'),'Late-wave UI must explicitly separate thesis correctness from entry timing');
gate('Capital not social chatter',html.includes('comportamiento agregado del capital')&&!html.includes('Reddit sentiment'),'Wisdom-of-crowds UI should mean capital behavior, not noisy social sentiment');
gate('Modal semantics',html.includes('role="dialog"')&&html.includes('aria-modal="true"')&&html.includes('aria-label="Cerrar dossier"'),'Modal requires dialog semantics and labelled close action');
gate('Keyboard activation',html.includes("e.key==='Enter'||e.key===' '")&&html.includes("if(e.key==='Escape')closeModal()"),'Cards must activate from keyboard and modal must close with Escape');
gate('Visible focus',html.includes(':focus-visible'),'Keyboard focus must remain visible');
gate('Reduced motion',html.includes('@media(prefers-reduced-motion:reduce)'),'Respect reduced-motion preference');
gate('Mobile collapse',html.includes('@media(max-width:900px)')&&html.includes('.passstrip{grid-template-columns:1fr}'),'Pass strip and primary layout must collapse on mobile');
gate('No forced broker proof UX',!html.includes('API instrumentos')&&!html.includes('brokerNotice'),'The dashboard must not ask the user for broker credentials or public-link verification');
gate('Dense data below fold',html.includes('WHY EACH COMPANY')&&html.includes('componentBars(t)'),'Detailed factors should live inside the dossier rather than the forest cards');

gate('Portfolio mode obvious',portfolio.includes('SHADOW <span>SLEEVE</span>')&&portfolio.includes('LIVE EXECUTION = OFF'),'Portfolio surface must never look like a live trading terminal');
gate('Budget visible',portfolio.includes('$500 BUDGET')&&portfolio.includes('$80 MAX')&&portfolio.includes('6 SLOTS'),'Capital constraints must be visible above the fold');
gate('Protected position visible',portfolio.includes('SGMOQ 🔒')&&portfolio.includes('SGMOQ · LOCKED OUT'),'SGMOQ isolation must be visually unmistakable');
gate('No-trade is first class',portfolio.includes('Nada. Eso también es una decisión.')&&portfolio.includes('NO SETUP = NO TRADE'),'Empty execution plan must be presented as an intentional decision');
gate('Regime gate visible',portfolio.includes('Market regime')&&portfolio.includes('Entry allowed'),'Market regime must be auditable from the portfolio page');
gate('Paper ledger visible',portfolio.includes('paper-portfolio.json')&&portfolio.includes('trade-journal.json'),'Portfolio UI must be grounded in explicit ledgers');
gate('Portfolio mobile',portfolio.includes('@media(max-width:950px)'),'Shadow portfolio must collapse cleanly on mobile');
gate('Portfolio reduced motion',portfolio.includes('@media(prefers-reduced-motion:reduce)'),'Shadow portfolio respects reduced-motion preference');

if(failures.length){console.error(`\nUI/UX audit failed (${failures.length}):\n- ${failures.join('\n- ')}`);process.exit(1)}
console.log('\nGearWatch UI/UX audit OK · 24/24 gates');
