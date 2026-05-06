const express = require('express');
const cors = require('cors');
const { KiteConnect, KiteTicker } = require('kiteconnect');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });

// ── State ─────────────────────────────────────────────────────────────────────
let accessToken   = null;
let basePnl       = null;
let baseExposure  = null;

// Live position data (refreshed from REST every 15s)
let activePositions = [];   // raw Kite position objects

// Tick prices: instrument_token → { ltp, restLtp, restPnl }
// restLtp/restPnl come from the last REST refresh; ltp is updated by ticks
const tickState = new Map();

// KiteTicker instance
let ticker = null;
let posRefreshTimer = null;

// Candle store
const TF = {
  '1m':  { ms: 60_000,     max: 400 },
  '5m':  { ms: 300_000,    max: 400 },
  '15m': { ms: 900_000,    max: 400 },
  '1h':  { ms: 3_600_000,  max: 400 },
  '1D':  { ms: 86_400_000, max: 400 },
};
const candles = { '1m': [], '5m': [], '15m': [], '1h': [], '1D': [] };

// SSE clients
const sseClients = new Set();

// ── Auth ──────────────────────────────────────────────────────────────────────
app.get('/api/login-url', (_req, res) => res.json({ url: kite.getLoginURL() }));

app.post('/api/auth', async (req, res) => {
  try {
    const session = await kite.generateSession(req.body.requestToken, process.env.KITE_API_SECRET);
    accessToken = session.access_token;
    kite.setAccessToken(accessToken);
    res.json({ success: true });
    startSession();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/set-token', (req, res) => {
  accessToken = req.body.token;
  kite.setAccessToken(req.body.token);
  res.json({ success: true });
  startSession();
});

app.get('/api/status', (_req, res) => res.json({ authenticated: !!accessToken }));

// ── Instrument parser ─────────────────────────────────────────────────────────
function parseInstrument(symbol) {
  if (symbol.endsWith('FUT')) {
    const body = symbol.slice(0, -3);
    const expiryMatch = body.match(/\d{2}[A-Z]{3}/);
    const expiry = expiryMatch ? expiryMatch[0] : '';
    return { underlying: body.replace(expiry, ''), expiry, type: 'FUT', strike: null };
  }
  const optType = symbol.endsWith('CE') ? 'CE' : symbol.endsWith('PE') ? 'PE' : null;
  if (optType) {
    const body = symbol.slice(0, -2);
    const expiryMatch = body.match(/\d{2}[A-Z]{3}/);
    const expiry = expiryMatch ? expiryMatch[0] : '';
    const idx = body.indexOf(expiry);
    const underlying = body.slice(0, idx);
    const strike = parseFloat(body.slice(idx + expiry.length)) || null;
    return { underlying, expiry, type: optType, strike };
  }
  return { underlying: symbol, expiry: '', type: 'UNKNOWN', strike: null };
}

// ── Candle aggregation ────────────────────────────────────────────────────────
function pushCandle(indexValue) {
  const now = Date.now();
  for (const [tf, { ms, max }] of Object.entries(TF)) {
    const bucket = Math.floor(now / ms) * ms;
    const arr = candles[tf];
    const last = arr[arr.length - 1];
    if (last && last.time === bucket) {
      last.high  = Math.max(last.high, indexValue);
      last.low   = Math.min(last.low,  indexValue);
      last.close = indexValue;
    } else {
      arr.push({ time: bucket, open: indexValue, high: indexValue, low: indexValue, close: indexValue });
      if (arr.length > max) arr.shift();
    }
  }
}

// ── Index calculation (tick-adjusted) ────────────────────────────────────────
// For each position:
//   current_pnl = rest_pnl + qty × (tick_ltp - rest_ltp)
// This preserves Kite's authoritative P&L (realised + unrealised at rest_ltp)
// and adjusts it in real-time as the tick price moves.
function calcIndexFromTicks() {
  if (!activePositions.length) {
    return { positions: [], indexValue: 100, totalExposure: 0, totalPnl: 0 };
  }

  const totalExposure = activePositions.reduce(
    (s, p) => s + Math.abs(p.quantity) * p.average_price, 0
  );

  const positions = activePositions.map((p) => {
    const ts = tickState.get(p.instrument_token) ?? {
      ltp: p.last_price, restLtp: p.last_price, restPnl: p.pnl,
    };
    const tickAdj  = p.quantity * (ts.ltp - ts.restLtp);
    const pnl      = ts.restPnl + tickAdj;
    const exposure = Math.abs(p.quantity) * p.average_price;
    const { underlying, expiry, type, strike } = parseInstrument(p.tradingsymbol);

    return {
      symbol: p.tradingsymbol, underlying, expiry,
      instrumentType: type, strike,
      exchange: p.exchange, product: p.product,
      quantity: p.quantity,
      avgPrice: p.average_price,
      lastPrice: ts.ltp,
      exposure,
      weight: totalExposure > 0 ? (exposure / totalExposure) * 100 : 0,
      pnl,
      pnlPct: exposure > 0 ? (pnl / exposure) * 100 : 0,
      side: p.quantity > 0 ? 'LONG' : 'SHORT',
    };
  });

  const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);

  if (basePnl === null) {
    basePnl      = totalPnl;
    baseExposure = totalExposure;
  }

  const indexValue = baseExposure > 0
    ? 100 + ((totalPnl - basePnl) / baseExposure) * 100
    : 100;

  return { positions, indexValue, totalExposure, totalPnl };
}

// ── SSE broadcast ─────────────────────────────────────────────────────────────
function broadcast() {
  if (!sseClients.size) return;
  const { positions, indexValue, totalExposure, totalPnl } = calcIndexFromTicks();
  pushCandle(indexValue);
  const payload = JSON.stringify({
    positions, indexValue, totalExposure, totalPnl,
    basePnl: basePnl ?? 0, baseExposure: baseExposure ?? 0,
    candles,
  });
  for (const client of sseClients) {
    client.write(`data: ${payload}\n\n`);
  }
}

// ── KiteTicker (WebSocket) ────────────────────────────────────────────────────
function subscribeTicker(tokens) {
  if (!tokens.length) return;
  ticker.subscribe(tokens);
  ticker.setMode(ticker.modeLTP, tokens);
}

function startTicker() {
  if (ticker) { try { ticker.disconnect(); } catch {} }

  ticker = new KiteTicker({ api_key: process.env.KITE_API_KEY, access_token: accessToken });

  ticker.on('connect', () => {
    console.log('KiteTicker connected ✓');
    const tokens = activePositions.map((p) => p.instrument_token);
    if (tokens.length) subscribeTicker(tokens);
  });

  ticker.on('ticks', (ticks) => {
    let changed = false;
    for (const tick of ticks) {
      const ts = tickState.get(tick.instrument_token);
      if (ts && tick.last_price !== ts.ltp) {
        ts.ltp = tick.last_price;
        changed = true;
      }
    }
    if (changed) broadcast();
  });

  ticker.on('disconnect', (err) => {
    console.log('KiteTicker disconnected:', err?.message ?? '');
    // Auto-reconnect after 3s
    if (accessToken) setTimeout(startTicker, 3000);
  });

  ticker.on('error', (err) => console.error('KiteTicker error:', err?.message));

  ticker.connect();
}

// ── Position refresh (REST, every 15s) ───────────────────────────────────────
async function refreshPositions() {
  if (!accessToken) return;
  try {
    const all  = await kite.getPositions();
    const fno  = (all.net || []).filter(
      (p) => (p.exchange === 'NFO' || p.exchange === 'BFO') && p.quantity !== 0
    );

    const prevTokens = new Set(activePositions.map((p) => p.instrument_token));
    const newTokens  = new Set(fno.map((p) => p.instrument_token));

    // Update tick state with fresh REST data
    for (const p of fno) {
      const existing = tickState.get(p.instrument_token);
      tickState.set(p.instrument_token, {
        ltp:     existing?.ltp ?? p.last_price,
        restLtp: p.last_price,
        restPnl: p.pnl,
      });
    }

    // Remove stale tokens
    for (const t of tickState.keys()) {
      if (!newTokens.has(t)) tickState.delete(t);
    }

    activePositions = fno;

    // Resubscribe if position set changed
    const tokensChanged =
      [...prevTokens].some((t) => !newTokens.has(t)) ||
      [...newTokens].some((t) => !prevTokens.has(t));

    if (ticker && tokensChanged) {
      const tokens = fno.map((p) => p.instrument_token);
      if (tokens.length) subscribeTicker(tokens);
    }

    // Always broadcast after REST refresh (keeps data fresh when market is closed)
    broadcast();
  } catch (err) {
    console.error('Position refresh error:', err.message);
  }
}

// ── Session start (called after auth) ────────────────────────────────────────
async function startSession() {
  // Stop any previous refresh loop
  if (posRefreshTimer) clearInterval(posRefreshTimer);

  await refreshPositions();                        // immediate first load
  posRefreshTimer = setInterval(refreshPositions, 15_000);  // then every 15s
  startTicker();                                   // WebSocket for live prices
}

// ── SSE stream endpoint ───────────────────────────────────────────────────────
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering
  res.flushHeaders();

  // Send current state immediately on connect
  const { positions, indexValue, totalExposure, totalPnl } = calcIndexFromTicks();
  res.write(`data: ${JSON.stringify({
    positions, indexValue, totalExposure, totalPnl,
    basePnl: basePnl ?? 0, baseExposure: baseExposure ?? 0, candles,
  })}\n\n`);

  sseClients.add(res);

  // Keep-alive ping every 25s so the connection isn't dropped by the browser
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(ping);
  });
});

// ── Snapshot (manual refresh fallback) ───────────────────────────────────────
app.get('/api/snapshot', async (_req, res) => {
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    await refreshPositions();
    const { positions, indexValue, totalExposure, totalPnl } = calcIndexFromTicks();
    res.json({ positions, indexValue, totalExposure, totalPnl, basePnl, baseExposure, candles });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Reset base ────────────────────────────────────────────────────────────────
app.post('/api/reset-base', async (_req, res) => {
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    await refreshPositions();
    const { totalPnl, totalExposure } = calcIndexFromTicks();
    basePnl      = totalPnl;
    baseExposure = totalExposure;
    for (const tf of Object.keys(candles)) candles[tf] = [];
    pushCandle(100);
    broadcast();
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Today's historical index ──────────────────────────────────────────────────
app.get('/api/today', async (_req, res) => {
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const fno = activePositions.length
      ? activePositions
      : (await kite.getPositions()).net.filter(
          (p) => (p.exchange === 'NFO' || p.exchange === 'BFO') && p.quantity !== 0
        );

    if (!fno.length) return res.json({ series: [], stats: null });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const fromDate = `${todayStr} 09:15:00`;
    const toDate   = `${todayStr} 15:30:00`;

    const histMap = new Map();
    for (const pos of fno) {
      try {
        const raw = await kite.getHistoricalData(pos.instrument_token, 'minute', fromDate, toDate);
        const m = new Map();
        for (const c of raw) m.set(new Date(c.date).getTime(), c);
        histMap.set(pos.instrument_token, m);
      } catch {
        histMap.set(pos.instrument_token, new Map());
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    const baseExp = fno.reduce((s, p) => s + Math.abs(p.quantity) * p.average_price, 0);
    if (baseExp === 0) return res.json({ series: [], stats: null });

    const openPrice = new Map();
    for (const pos of fno) {
      const m = histMap.get(pos.instrument_token);
      const first = m && m.size > 0 ? [...m.values()][0] : null;
      openPrice.set(pos.instrument_token, first ? first.open : pos.average_price);
    }

    const allTimes = new Set();
    for (const m of histMap.values()) for (const t of m.keys()) allTimes.add(t);
    const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

    const latestClose = new Map();
    for (const pos of fno) latestClose.set(pos.instrument_token, openPrice.get(pos.instrument_token));

    let dayHigh = 100, dayLow = 100;
    const series = sortedTimes.map((t) => {
      for (const pos of fno) {
        const c = histMap.get(pos.instrument_token)?.get(t);
        if (c) latestClose.set(pos.instrument_token, c.close);
      }
      const pnlFromOpen = fno.reduce((s, pos) => {
        const curr = latestClose.get(pos.instrument_token) ?? openPrice.get(pos.instrument_token);
        return s + pos.quantity * (curr - openPrice.get(pos.instrument_token));
      }, 0);
      const value = 100 + (pnlFromOpen / baseExp) * 100;
      dayHigh = Math.max(dayHigh, value);
      dayLow  = Math.min(dayLow,  value);
      return { time: t, value };
    });

    const current = series.length ? series[series.length - 1].value : 100;
    res.json({
      series,
      stats: {
        dayOpen: 100, dayHigh, dayLow,
        dayChange: current - 100, dayChangePct: current - 100,
        currentValue: current, baseExposure: baseExp,
        positionCount: fno.length, dataPoints: series.length,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
