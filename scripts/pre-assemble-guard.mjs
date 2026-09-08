import fs from 'node:fs/promises';
import {guardMechanismEvidence} from './mechanism-guards.mjs';

const path='data/extraction/latest.json',currentPath='data/current.json';
const extraction=JSON.parse(await fs.readFile(path,'utf8').catch(()=>'{"mechanisms":{}}'));
const current=JSON.parse(await fs.readFile(currentPath,'utf8').catch(()=>'{"mechanisms":{}}'));
let rejected=0,cachedRejected=0;
for(const [id,m] of Object.entries(extraction.mechanisms||{})){
  const g=guardMechanismEvidence(id,m.evidence||[]);
  if(g.rejected.length){
    rejected+=g.rejected.length;
    m.evidence=g.accepted;
    m.semantic_guard={applied:true,rejected_count:g.rejected.length,rejected:g.rejected.map(e=>({signal:e.signal||null,claim:e.claim||null,source:e.source_domain||e.source_name||null,reason:e.semantic_rejection}))};
    if(!g.accepted.length)m.summary=`Semantic guard removed ${g.rejected.length} cross-mechanism evidence item(s); awaiting mechanism-specific confirmation.`;
  }else m.semantic_guard={applied:true,rejected_count:0,rejected:[]};
}
for(const [id,m] of Object.entries(current.mechanisms||{})){
  const g=guardMechanismEvidence(id,m.evidence||[]);
  if(g.rejected.length){
    cachedRejected+=g.rejected.length;
    m.evidence=g.accepted;
    m.observed_evidence=guardMechanismEvidence(id,m.observed_evidence||[]).accepted;
  }
}
await fs.writeFile(path,JSON.stringify(extraction,null,2)+'\n');
if(cachedRejected)await fs.writeFile(currentPath,JSON.stringify(current,null,2)+'\n');
console.log(`semantic guard: rejected=${rejected} cached_rejected=${cachedRejected}`);
