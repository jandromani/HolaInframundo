import {
  trading212Config,
  getAccountSummary,
  getPositions,
  getPendingOrders,
  getInstruments,
  placeOrder,
  cancelOrder
} from '../lib/trading212.mjs';

function bearer(req){
  const value=String(req.headers?.authorization||'');
  return value.startsWith('Bearer ')?value.slice(7):'';
}
function authorized(req){
  const expected=process.env.GEARWATCH_BROKER_TOKEN||'';
  return Boolean(expected) && bearer(req)===expected;
}
function send(res,status,payload){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.status(status).json(payload);
}
function safeError(error){
  return {
    error:error?.message||'Broker gateway error',
    status:Number(error?.status)||500,
    retry_after:error?.retryAfter||null,
    rate_period:error?.ratePeriod||null
  };
}

export default async function handler(req,res){
  if(req.method==='OPTIONS') return send(res,204,{});
  if(!authorized(req)) return send(res,401,{error:'Unauthorized broker gateway request'});

  const cfg=trading212Config();
  if(!cfg.configured) return send(res,503,{error:'Trading 212 credentials are not configured',config:cfg});

  try{
    if(req.method==='GET'){
      const action=String(req.query?.action||'status');
      if(action==='status'){
        const [account,positions,orders]=await Promise.all([
          getAccountSummary(), getPositions(), getPendingOrders()
        ]);
        return send(res,200,{config:cfg,account,positions,orders});
      }
      if(action==='instruments'){
        const instruments=await getInstruments();
        return send(res,200,{config:cfg,count:Array.isArray(instruments)?instruments.length:0,instruments});
      }
      return send(res,400,{error:'Unknown GET action'});
    }

    if(req.method==='POST'){
      const action=String(req.body?.action||'');
      if(action==='order'){
        const result=await placeOrder(req.body?.order||{}, { confirmation:req.body?.confirmation });
        return send(res,200,{ok:true,result});
      }
      if(action==='cancel'){
        const id=req.body?.orderId;
        if(id===undefined||id===null||id==='') return send(res,400,{error:'orderId is required'});
        const result=await cancelOrder(id);
        return send(res,200,{ok:true,result});
      }
      return send(res,400,{error:'Unknown POST action'});
    }

    return send(res,405,{error:'Method not allowed'});
  }catch(error){
    const safe=safeError(error);
    return send(res,safe.status>=400&&safe.status<600?safe.status:500,safe);
  }
}
