const key = process.env.TRADING212_API_KEY || process.env.T212_API_KEY || '';
const secret = process.env.TRADING212_API_SECRET || process.env.T212_API_SECRET || '';
const environment = (process.env.TRADING212_ENV || process.env.T212_ENV || 'live').toLowerCase() === 'demo' ? 'demo' : 'live';
const baseUrl = environment === 'demo'
  ? 'https://demo.trading212.com/api/v0'
  : 'https://live.trading212.com/api/v0';
const protectedSymbols = new Set(['SGMOQ',...(process.env.T212_PROTECTED_SYMBOLS||'').split(',')].map(x=>String(x||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'')).filter(Boolean));

function normalizedTicker(value){return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'')}
function assertUnprotectedTicker(value){
  const n=normalizedTicker(value);
  if(!n) throw new Error('Cannot prove order ticker; broker write blocked fail-closed');
  for(const p of protectedSymbols) if(n===p||n.startsWith(p)) throw new Error(`Protected symbol ${p} is isolated from GearWatch broker writes`);
}

export function trading212Config() {
  return {
    environment,
    baseUrl,
    configured: Boolean(key),
    authMode: secret ? 'KEY_PAIR_BASIC' : (key ? 'LEGACY_API_KEY' : 'NONE'),
    liveTradingEnabled: process.env.T212_LIVE_TRADING_ENABLED === 'true',
    protectedSymbols:[...protectedSymbols]
  };
}

function authHeaders() {
  if (!key) throw new Error('Trading 212 credentials are not configured');
  if (secret) {
    const encoded = Buffer.from(`${key}:${secret}`, 'utf8').toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  return { Authorization: key };
}

async function request(path, { method='GET', body, timeoutMs=15000 }={}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...authHeaders(),
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });

    const text = await res.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { raw: text.slice(0, 1000) }; }
    }

    if (!res.ok) {
      const retryAfter = res.headers.get('retry-after');
      const ratePeriod = res.headers.get('x-ratelimit-period');
      const err = new Error(`Trading 212 HTTP ${res.status}`);
      err.status = res.status;
      err.payload = payload;
      err.retryAfter = retryAfter;
      err.ratePeriod = ratePeriod;
      throw err;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export const getInstruments = () => request('/equity/metadata/instruments', { timeoutMs: 30000 });
export const getExchanges = () => request('/equity/metadata/exchanges', { timeoutMs: 30000 });
export const getAccountSummary = () => request('/equity/account/summary');
export const getPositions = () => request('/equity/positions');
export const getPendingOrders = () => request('/equity/orders');
export const getOrder = id => request(`/equity/orders/${encodeURIComponent(id)}`);
export async function cancelOrder(id){
  const existing=await getOrder(id);
  const ticker=existing?.ticker||existing?.instrumentTicker||existing?.instrument?.ticker||existing?.tickerName||'';
  assertUnprotectedTicker(ticker);
  return request(`/equity/orders/${encodeURIComponent(id)}`, { method:'DELETE' });
}

function assertFiniteNumber(name, value) {
  if (!Number.isFinite(Number(value))) throw new Error(`${name} must be a finite number`);
  return Number(value);
}

function assertTicker(ticker) {
  const value = String(ticker || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error('ticker must be a Trading 212 instrument identifier');
  assertUnprotectedTicker(value);
  return value;
}

function assertTimeValidity(value='DAY') {
  const v = String(value).toUpperCase();
  if (!['DAY','GOOD_TILL_CANCEL'].includes(v)) throw new Error('timeValidity must be DAY or GOOD_TILL_CANCEL');
  return v;
}

function assertLiveExecutionArmed(confirmation) {
  if (environment !== 'live') return;
  if (process.env.T212_LIVE_TRADING_ENABLED !== 'true') {
    throw new Error('Live Trading 212 execution is disabled by T212_LIVE_TRADING_ENABLED');
  }
  if (confirmation !== 'EXECUTE_LIVE') {
    throw new Error('Live order requires explicit EXECUTE_LIVE confirmation');
  }
}

export async function placeOrder(order, { confirmation }={}) {
  assertLiveExecutionArmed(confirmation);
  const type = String(order?.type || 'MARKET').toUpperCase();
  const ticker = assertTicker(order?.ticker);
  const quantity = assertFiniteNumber('quantity', order?.quantity);
  if (quantity === 0) throw new Error('quantity cannot be zero');

  // Trading 212 order POSTs are not idempotent. Never auto-retry them.
  if (type === 'MARKET') {
    return request('/equity/orders/market', {
      method: 'POST',
      body: { ticker, quantity, extendedHours: Boolean(order?.extendedHours) }
    });
  }

  const timeValidity = assertTimeValidity(order?.timeValidity);
  if (type === 'LIMIT') {
    return request('/equity/orders/limit', {
      method: 'POST',
      body: { ticker, quantity, limitPrice: assertFiniteNumber('limitPrice', order?.limitPrice), timeValidity }
    });
  }
  if (type === 'STOP') {
    return request('/equity/orders/stop', {
      method: 'POST',
      body: { ticker, quantity, stopPrice: assertFiniteNumber('stopPrice', order?.stopPrice), timeValidity }
    });
  }
  if (type === 'STOP_LIMIT') {
    return request('/equity/orders/stop_limit', {
      method: 'POST',
      body: {
        ticker,
        quantity,
        stopPrice: assertFiniteNumber('stopPrice', order?.stopPrice),
        limitPrice: assertFiniteNumber('limitPrice', order?.limitPrice),
        timeValidity
      }
    });
  }
  throw new Error(`Unsupported order type: ${type}`);
}
