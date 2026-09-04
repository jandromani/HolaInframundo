import { getInstruments, trading212Config } from '../lib/trading212.mjs';

const cfg=trading212Config();
if(!cfg.configured){
  console.error('Trading 212 credentials are not configured');
  process.exit(2);
}

try{
  const instruments=await getInstruments();
  console.log(JSON.stringify({
    ok:true,
    environment:cfg.environment,
    auth_mode:cfg.authMode,
    instrument_count:Array.isArray(instruments)?instruments.length:0
  }));
}catch(error){
  console.error(JSON.stringify({
    ok:false,
    environment:cfg.environment,
    auth_mode:cfg.authMode,
    status:error?.status||null,
    error:error?.message||'Trading 212 probe failed'
  }));
  process.exit(1);
}
