import fs from 'node:fs/promises';

const read=async(path,fallback={})=>JSON.parse(await fs.readFile(path,'utf8').catch(()=>JSON.stringify(fallback)));
const [cfg,seeds,q1,qx,retr,current,broker,inv,policy,plan,paper,journal,modelHealth]=await Promise.all([
  read('config/mechanisms.json',{mechanisms:[]}),
  read('config/investment-seeds.json',{mechanisms:{}}),
  read('config/queries.v2.json',{mechanisms:{}}),
  read('config/queries.v2.extra.json',{mechanisms:{}}),
  read('data/retrieval/latest.json',{mechanisms:{},coverage:{}}),
  read('data/current.json',{mechanisms:{},health:{}}),
  read('data/broker.json',{instruments:{},stats:{}}),
  read('data/investment-layer.json',{strategies:{},summary:{}}),
  read('config/execution-policy.json',{}),
  read('data/execution-plan.json',{regime:{},summary:{}}),
  read('data/paper-portfolio.json',{positions:[],stats:{}}),
  read('data/trade-journal.json',{trades:[],stats:{}}),
  read('data/model-health.json',{models:{}})
]);

const queries={...(q1.mechanisms||{}),...(qx.mechanisms||{})};
const TARGET_SEEDS=10,MIN_SEEDS=8,MIN_DIRECT=4;
const uniq=a=>[...new Set(a.filter(Boolean))];
const phases=q=>['lead','confirm','lag'].flatMap(p=>(q?.[p]||[]).map(x=>({...x,phase:p.toUpperCase()})));
const engineRows=qRows=>qRows.flatMap(q=>Object.entries(q.engines||{}).map(([engine,x])=>({query_id:q.query_id,engine,...x})));
const countHits=e=>Number.isFinite(Number(e?.count))?Number(e.count):0;
const queryHasNativeHit=q=>Object.values(q.engines||{}).some(e=>e?.ok===true&&countHits(e)>0);
const querySucceededEmpty=q=>{
  const es=Object.values(q.engines||{});
  return es.some(e=>e?.ok===true)&&!queryHasNativeHit(q);
};
const issue=(code,severity,detail)=>({code,severity,detail});

const rows=[];
for(const m of cfg.mechanisms||[]){
  const seedRows=seeds.mechanisms?.[m.id]||[];
  const directSeeds=seedRows.filter(x=>x[2]==='DIRECT');
  const qCfg=queries[m.id]||{};
  const configuredQueries=phases(qCfg);
  const r=retr.mechanisms?.[m.id]||{};
  const qRows=r.queries||[];
  const engines=engineRows(qRows);
  const nativeHits=engines.reduce((a,e)=>a+countHits(e),0);
  const failedEngines=engines.filter(e=>e.ok===false&&!e.skipped);
  const timeouts=failedEngines.filter(e=>/timeout|aborted/i.test(String(e.error||'')));
  const zeroQueries=qRows.filter(querySucceededEmpty);
  const candidates=r.candidates||[];
  const fallbackCandidates=candidates.filter(x=>x.fallback||x.engine==='openrouter_web_fallback');
  const officialCandidates=candidates.filter(x=>x.official===true||x.engine==='official_rss');
  const cur=current.mechanisms?.[m.id]||{};
  const observed=cur.observed_evidence||[];
  const evidence=cur.evidence||[];
  const validEvidence=evidence.filter(x=>x.valid!==false);
  const domains=uniq(validEvidence.map(x=>x.source_domain));
  const strategy=inv.strategies?.[m.id]||{};
  const top5=strategy.top5||[];
  const directTop=top5.filter(x=>x.exposure==='DIRECT');
  const brokerVerifiedTop=top5.filter(x=>x.broker_verified===true);
  const noMarketTop=top5.filter(x=>x.market?.quality==='NO_MARKET'||!Number.isFinite(Number(x.market?.price)));
  const problems=[];
  if(seedRows.length<MIN_SEEDS) problems.push(issue('SEED_POOL_TOO_SMALL','HIGH',`${seedRows.length} candidates; target ${TARGET_SEEDS}, minimum ${MIN_SEEDS}.`));
  else if(seedRows.length<TARGET_SEEDS) problems.push(issue('SEED_POOL_BELOW_TARGET','MEDIUM',`${seedRows.length} candidates; target ${TARGET_SEEDS}.`));
  if(directSeeds.length<MIN_DIRECT) problems.push(issue('DIRECT_EXPOSURE_THIN','HIGH',`${directSeeds.length} DIRECT candidates; minimum ${MIN_DIRECT}.`));
  if(configuredQueries.length===0) problems.push(issue('NO_QUERY_CONFIG','CRITICAL','No retrieval queries configured.'));
  if(qRows.length<configuredQueries.length) problems.push(issue('QUERY_COVERAGE_INCOMPLETE','HIGH',`${qRows.length}/${configuredQueries.length} configured queries executed/reported.`));
  if(qRows.length&&zeroQueries.length/qRows.length>=0.75) problems.push(issue('NATIVE_SEARCH_MOSTLY_ZERO','MEDIUM',`${zeroQueries.length}/${qRows.length} queries returned zero native-engine hits.`));
  if(failedEngines.length) problems.push(issue('RETRIEVER_ERRORS','MEDIUM',`${failedEngines.length} engine failures (${timeouts.length} timeout/abort).`));
  if(candidates.length===0) problems.push(issue('NO_RETRIEVAL_CANDIDATES','HIGH','No candidate evidence retrieved in the latest run.'));
  else if(nativeHits===0&&fallbackCandidates.length) problems.push(issue('FALLBACK_DEPENDENT','MEDIUM',`${fallbackCandidates.length} fallback candidates rescued native search blindness.`));
  if(observed.length===0&&candidates.length>0) problems.push(issue('NO_OBSERVED_EVIDENCE','LOW','Candidates exist but none survived as newly observed evidence this cycle.'));
  if(top5.length<5) problems.push(issue('TOP5_SHORT','HIGH',`Investment layer has ${top5.length}/5 ranked candidates.`));
  if(directTop.length<3) problems.push(issue('TOP5_DIRECT_THIN','MEDIUM',`${directTop.length}/5 Top candidates are DIRECT exposure.`));
  if(noMarketTop.length) problems.push(issue('MARKET_DATA_GAPS','HIGH',`${noMarketTop.length} Top candidates lack usable market price telemetry.`));
  if(broker.authoritative===true&&brokerVerifiedTop.length<top5.length) problems.push(issue('T212_LIVE_GAPS','HIGH',`${brokerVerifiedTop.length}/${top5.length} Top candidates live-verified on T212.`));

  const severityRank={CRITICAL:4,HIGH:3,MEDIUM:2,LOW:1};
  const worst=Math.max(0,...problems.map(x=>severityRank[x.severity]||0));
  const grade=worst>=4?'F':worst===3?'C':worst===2?'B':worst===1?'A-':'A';
  rows.push({
    id:m.id,label:m.label,tier:m.tier,grade,
    companies:{seed_count:seedRows.length,target:TARGET_SEEDS,direct_seed_count:directSeeds.length,proxy_seed_count:seedRows.length-directSeeds.length,top5_count:top5.length,top5_direct:directTop.length,top5_symbols:top5.map(x=>x.symbol)},
    search:{configured_queries:configuredQueries.length,reported_queries:qRows.length,native_hits:nativeHits,zero_native_queries:zeroQueries.length,zero_native_ratio:qRows.length?+(zeroQueries.length/qRows.length).toFixed(3):null,engine_failures:failedEngines.length,timeouts:timeouts.length,retrieval_candidates:candidates.length,fallback_candidates:fallbackCandidates.length,official_candidates:officialCandidates.length},
    evidence:{observed:observed.length,total:evidence.length,valid:validEvidence.length,unique_domains:domains.length,state:cur.state||'UNKNOWN',causal_score:Number(cur.score||0)},
    investment:{action:strategy.action||null,opportunity_score:Number(strategy.opportunity_score||0),transmission_score:Number(strategy.transmission_score||0),quality:strategy.quality||null,broker_strict:Boolean(strategy.broker_strict),broker_verified_top5:brokerVerifiedTop.length},
    issues:problems
  });
}

const severityCounts={critical:0,high:0,medium:0,low:0};
for(const r of rows)for(const x of r.issues){const k=x.severity.toLowerCase();severityCounts[k]=(severityCounts[k]||0)+1}
const seedSymbols=uniq(Object.values(seeds.mechanisms||{}).flat().map(x=>x[0]));
const protectedSet=new Set((policy.protected_symbols||[]).map(x=>String(x).toUpperCase()));
const sgmoqIsolated=protectedSet.has('SGMOQ')&&!(paper.positions||[]).some(x=>String(x.symbol||'').toUpperCase().startsWith('SGMOQ'));
const budgetOk=Number(policy.capital?.initial_budget_usd)===500&&Number(policy.capital?.max_order_usd)===80&&Number(policy.capital?.max_open_positions)===6;
const liveOff=policy.mode==='SHADOW_ONLY'&&policy.execution?.auto_live_orders===false&&plan.summary?.live_execution===false;
const fresh=plan.regime?.freshness?.fresh;
const globalIssues=[];
if(!sgmoqIsolated)globalIssues.push(issue('SGMOQ_ISOLATION_BROKEN','CRITICAL','SGMOQ guardrail or paper-sleeve isolation failed.'));
if(!budgetOk)globalIssues.push(issue('CAPITAL_INVARIANTS_CHANGED','CRITICAL','Expected $500 budget / $80 max order / 6 slots.'));
if(!liveOff)globalIssues.push(issue('LIVE_EXECUTION_NOT_OFF','CRITICAL','Autonomous live execution must remain disabled.'));
if(broker.authoritative!==true)globalIssues.push(issue('T212_NOT_LIVE_VERIFIED','HIGH',`Broker mode is ${broker.mode||'UNKNOWN'}; curated availability is not authoritative.`));
if(fresh===false)globalIssues.push(issue('MARKET_TELEMETRY_STALE','MEDIUM','Entry gate is closed until at least three benchmark feeds are fresh.'));
if((current.health?.retrieval_errors||0)>0)globalIssues.push(issue('CURRENT_RETRIEVAL_ERRORS','MEDIUM',`${current.health.retrieval_errors} retrieval errors in current health.`));
if((current.health?.verification_errors||0)>0)globalIssues.push(issue('CURRENT_VERIFICATION_ERRORS','LOW',`${current.health.verification_errors} verification errors in current health.`));

const badModels=Object.entries(modelHealth.models||{}).filter(([,x])=>Number(x.fail||0)>0&&Number(x.success||0)===0).map(([name,x])=>({name,fail:x.fail,last_error:x.last_error||null}));
const report={
  version:'3.1.0',generated_at:new Date().toISOString(),run_id:current.run_id||retr.run_id||plan.run_id||null,
  verdict:globalIssues.some(x=>x.severity==='CRITICAL')?'FAIL':(globalIssues.some(x=>x.severity==='HIGH')||rows.some(x=>x.grade==='C'||x.grade==='F'))?'NEEDS_ATTENTION':'HEALTHY',
  summary:{
    mechanisms:rows.length,
    mechanism_grades:Object.fromEntries(['A','A-','B','C','F'].map(g=>[g,rows.filter(x=>x.grade===g).length])),
    seed_rows:Object.values(seeds.mechanisms||{}).reduce((a,x)=>a+x.length,0),unique_seed_symbols:seedSymbols.length,
    mechanisms_below_8_candidates:rows.filter(x=>x.companies.seed_count<8).length,
    mechanisms_below_4_direct:rows.filter(x=>x.companies.direct_seed_count<4).length,
    mechanisms_fallback_dependent:rows.filter(x=>x.issues.some(i=>i.code==='FALLBACK_DEPENDENT')).length,
    mechanisms_no_retrieval_candidates:rows.filter(x=>x.search.retrieval_candidates===0).length,
    severity_counts:severityCounts
  },
  trading212:{mode:broker.mode||'UNKNOWN',authoritative:Boolean(broker.authoritative),catalogue_verified:Boolean(broker.catalogue_verified),availability_gate:Boolean(broker.availability_gate),seed_symbols:Number(broker.stats?.seed_symbols||0),verified:Number(broker.stats?.verified||0),assumed_available:Number(broker.stats?.assumed_available||0),coverage:Number(broker.coverage||0),errors:broker.errors||[]},
  shadow:{mode:paper.mode||policy.mode,budget_usd:Number(policy.capital?.initial_budget_usd||0),max_order_usd:Number(policy.capital?.max_order_usd||0),max_positions:Number(policy.capital?.max_open_positions||0),cash_usd:Number(paper.cash_usd||0),nav_usd:Number(paper.nav_usd||0),open_positions:(paper.positions||[]).length,available_slots:Number(paper.stats?.available_slots??0),trades:(journal.trades||[]).length,sgmoq_isolated:sgmoqIsolated,live_execution_off:liveOff,market_entry_allowed:Boolean(plan.regime?.entry_allowed),market_block_reason:plan.regime?.block_reason||null,market_freshness:plan.regime?.freshness||null},
  model_health:{known_dead_or_obsolete:badModels},
  global_issues:globalIssues,
  mechanisms:rows
};

await fs.writeFile('data/audit-v3.json',JSON.stringify(report,null,2)+'\n');
console.log(`audit v3: verdict=${report.verdict} mechanisms=${rows.length} <8seeds=${report.summary.mechanisms_below_8_candidates} <4direct=${report.summary.mechanisms_below_4_direct} noCandidates=${report.summary.mechanisms_no_retrieval_candidates} t212=${report.trading212.mode} shadow=${report.shadow.mode}`);
