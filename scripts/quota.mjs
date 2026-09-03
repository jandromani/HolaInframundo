import fs from 'node:fs/promises';

const key=process.env.OPENROUTER_API_KEY;
if(!key){console.error('OPENROUTER_API_KEY missing');process.exit(2)}
const policy=JSON.parse(await fs.readFile('config/policy.v2.json','utf8'));
const now=new Date();
const fallback=50;
let raw=null,error=null;
try{
  const r=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
  const text=await r.text();
  if(!r.ok)throw new Error(`OpenRouter key status ${r.status}: ${text.slice(0,160)}`);
  raw=JSON.parse(text)?.data||{};
}catch(e){error=String(e.message||e)}

// Never persist the key, key label, user identity or any auth material.
const isFree=raw?.is_free_tier;
const documentedFreeModelRpd=isFree===false?1000:50;
const reportedRemaining=Number.isFinite(raw?.limit_remaining)?Number(raw.limit_remaining):null;
const policyCap=policy.budgets?.max_llm_requests_per_day||140;
const safeDailyRequests=Math.max(1,Math.min(policyCap,documentedFreeModelRpd));
const verifierReserve=Math.min(policy.budgets?.max_web_verifiers_per_day||12,Math.max(2,Math.floor(safeDailyRequests*.18)));
const extractionDailyCap=Math.max(1,safeDailyRequests-verifierReserve);
const out={
  version:'2.0.0',checked_at:now.toISOString(),ok:!error,error,
  is_free_tier:isFree??null,
  usage:Number.isFinite(raw?.usage)?raw.usage:null,
  usage_daily:Number.isFinite(raw?.usage_daily)?raw.usage_daily:null,
  usage_weekly:Number.isFinite(raw?.usage_weekly)?raw.usage_weekly:null,
  usage_monthly:Number.isFinite(raw?.usage_monthly)?raw.usage_monthly:null,
  reported_limit:Number.isFinite(raw?.limit)?raw.limit:null,
  reported_limit_remaining:reportedRemaining,
  inferred_free_model_rpd:documentedFreeModelRpd,
  safe_daily_requests:safeDailyRequests,
  extraction_daily_cap:extractionDailyCap,
  verifier_daily_reserve:verifierReserve,
  fallback_used:Boolean(error||raw==null)
};
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/openrouter-quota.json',JSON.stringify(out,null,2)+'\n');
console.log(`quota: free_tier=${String(out.is_free_tier)} safe=${safeDailyRequests}/day extraction=${extractionDailyCap} verifier_reserve=${verifierReserve} remaining=${reportedRemaining??'unknown'}${error?' fallback':''}`);
