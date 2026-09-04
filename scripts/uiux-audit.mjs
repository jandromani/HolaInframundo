import fs from 'node:fs/promises';

const html=await fs.readFile('index.html','utf8');
const failures=[];
const gate=(name,ok,why)=>{if(!ok)failures.push(`${name}: ${why}`);console.log(`${ok?'PASS':'FAIL'} · ${name}`)};
const pos=s=>html.indexOf(s);

gate('Decision hierarchy',pos('4 · Causal')>=0&&pos('5 · Pass 1')>pos('4 · Causal')&&pos('6 · Pass 2')>pos('5 · Pass 1')&&pos('7 · Final TX')>pos('6 · Pass 2')&&pos('8 · Market Vote')>pos('7 · Final TX'),'Expected Causal → Pass 1 → Pass 2 → Final TX → Market ordering');
gate('Broker simplicity',!html.includes('trading212.com')&&!/href=["'][^"']*212/i.test(html)&&html.includes('T212 ✓'),'Trading 212 should be a curated availability flag, never a runtime link');
gate('Progressive disclosure',html.includes('<details class=company>')&&html.includes('<summary>'),'Per-company diagnostics must stay collapsed until requested');
gate('Three-metric card hierarchy',html.includes('<span>CAUSAL</span>')&&html.includes('<span>FINAL TX</span>')&&html.includes('<span>MARKET</span>'),'Mechanism cards must expose decision metrics before diagnostics');
gate('Two-pass explainability',html.includes('PASS 1 · STRUCTURAL')&&html.includes('PASS 2 · FINANCIAL')&&html.includes('FINAL TX')&&html.includes('weight_applied')===false,'UI must expose both passes and final result without leaking internal implementation noise');
gate('Modal semantics',html.includes('role="dialog"')&&html.includes('aria-modal="true"')&&html.includes('aria-label="Cerrar dossier"'),'Modal requires dialog semantics and labelled close action');
gate('Keyboard activation',html.includes("e.key==='Enter'||e.key===' '")&&html.includes("if(e.key==='Escape')closeModal()"),'Cards must activate from keyboard and modal must close with Escape');
gate('Visible focus',html.includes(':focus-visible'),'Keyboard focus must remain visible');
gate('Reduced motion',html.includes('@media(prefers-reduced-motion:reduce)'),'Respect reduced-motion preference');
gate('Mobile collapse',html.includes('@media(max-width:900px)')&&html.includes('.passstrip{grid-template-columns:1fr}'),'Pass strip and primary layout must collapse on mobile');
gate('No forced broker proof UX',!html.includes('API instrumentos')&&!html.includes('brokerNotice'),'The dashboard must not ask the user for broker credentials or public-link verification');
gate('Dense data below fold',html.includes('WHY EACH COMPANY')&&html.includes('componentBars(t)'),'Detailed factors should live inside the dossier rather than the forest cards');

if(failures.length){console.error(`\nUI/UX audit failed (${failures.length}):\n- ${failures.join('\n- ')}`);process.exit(1)}
console.log('\nGearWatch UI/UX audit OK · 12/12 gates');
