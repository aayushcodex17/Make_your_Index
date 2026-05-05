const express = require('express');
const cors = require('cors');
const { KiteConnect } = require('kiteconnect');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });

// ── State ─────────────────────────────────────────────────────────────────────
let accessToken = null;
let basePnl = null;        // total P&L at the time base was locked
let baseExposure = null;   // total exposure at the time base was locked

// Candle store per timeframe
const TF = {
  '1m':  { ms: 60_000,       max: 400 },
  '5m':  { ms: 300_000,      max: 400 },
  '15m': { ms: 900_000,      max: 400 },
  '1h':  { ms: 3_600_000,    max: 400 },
  '1D':  { ms: 86_400_000,   max: 400 },
};
const candles = { '1m': [], '5m': [], '15m': [], '1h': [], '1D': [] };

// ── Auth ──────────────────────────────────────────────────────────────────────
app.get('/api/login-url', (_req, res) => res.json({ url: kite.getLoginURL() }));

app.post('/api/auth', async (req, res) => {
  try {
    const session = await kite.generateSession(req.body.requestToken, process.env.KITE_API_SECRET);
    accessToken = session.access_token;
    kite.setAccessToken(accessToken);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/set-token', (req, res) => {
  accessToken = req.body.token;
  kite.setAccessToken(req.body.token);
  res.json({ success: true });
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
      last.high = Math.max(last.high, indexValue);
      last.low = Math.min(last.low, indexValue);
      last.close = indexValue;
    } else {
      arr.push({ time: bucket, open: indexValue, high: indexValue, low: indexValue, close: indexValue });
      if (arr.length > max) arr.shift();
    }
  }
}

// ── Index calculation ─────────────────────────────────────────────────────────
function calcIndex(fnoPositions) {
  // exposure = |qty| × avg_entry_price  (actual capital deployed / premium paid)
  const totalExposure = fnoPositions.reduce(
    (s, p) => s + Math.abs(p.quantity) * p.average_price, 0
  );

  // Kite gives us realised + unrealised pnl directly in the position object
  const totalPnl = fnoPositions.reduce((s, p) => s + p.pnl, 0);

  const positions = fnoPositions.map((p) => {
    const exposure = Math.abs(p.quantity) * p.average_price;
    const { underlying, expiry, type, strike } = parseInstrument(p.tradingsymbol);
    return {
      symbol: p.tradingsymbol,
      underlying,
      expiry,
      instrumentType: type,
      strike,
      exchange: p.exchange,
      product: p.product,
      quantity: p.quantity,
      avgPrice: p.average_price,
      lastPrice: p.last_price,
      exposure,
      weight: totalExposure > 0 ? (exposure / totalExposure) * 100 : 0,
      pnl: p.pnl,
      pnlPct: p.average_price > 0 ? (p.pnl / exposure) * 100 : 0,
      side: p.quantity > 0 ? 'LONG' : 'SHORT',
    };
  });

  return { positions, totalExposure, totalPnl };
}

// ── Snapshot endpoint ─────────────────────────────────────────────────────────
app.get('/api/snapshot', async (_req, res) => {
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const all = await kite.getPositions();

    // Net positions in F&O segment with active quantity
    const fno = (all.net || []).filter(
      (p) => (p.exchange === 'NFO' || p.exchange === 'BFO') && p.quantity !== 0
    );

    if (!fno.length) {
      return res.json({
        positions: [], indexValue: 100, totalExposure: 0, totalPnl: 0,
        basePnl: basePnl ?? 0, baseExposure: baseExposure ?? 0,
        candles,
      });
    }

    const { positions, totalExposure, totalPnl } = calcIndex(fno);

    // Lock base on first call
    if (basePnl === null) {
      basePnl = totalPnl;
      baseExposure = totalExposure;
    }

    // Index = 100 + Δ(pnl) / base_exposure × 100
    const indexValue = baseExposure > 0
      ? 100 + ((totalPnl - basePnl) / baseExposure) * 100
      : 100;

    pushCandle(indexValue);

    res.json({ positions, indexValue, totalExposure, totalPnl, basePnl, baseExposure, candles });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Reset base ────────────────────────────────────────────────────────────────
app.post('/api/reset-base', async (_req, res) => {
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const all = await kite.getPositions();
    const fno = (all.net || []).filter(
      (p) => (p.exchange === 'NFO' || p.exchange === 'BFO') && p.quantity !== 0
    );
    basePnl = fno.reduce((s, p) => s + p.pnl, 0);
    baseExposure = fno.reduce((s, p) => s + Math.abs(p.quantity) * p.average_price, 0);
    for (const tf of Object.keys(candles)) candles[tf] = [];
    pushCandle(100);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Today's historical index ──────────────────────────────────────────────────
app.get('/api/today', async (_req, res) => {
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const all = await kite.getPositions();
    const fno = (all.net || []).filter(
      (p) => (p.exchange === 'NFO' || p.exchange === 'BFO') && p.quantity !== 0
    );
    if (!fno.length) return res.json({ series: [], stats: null });

    // Today's range in IST (server assumed IST)
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const fromDate = `${todayStr} 09:15:00`;
    const toDate   = `${todayStr} 15:30:00`;

    // Fetch minute candles for each instrument sequentially (Kite: 3 req/s)
    const histMap = new Map(); // instrument_token -> Map<epochMs, candle>
    for (const pos of fno) {
      try {
        const raw = await kite.getHistoricalData(pos.instrument_token, 'minute', fromDate, toDate);
        const m = new Map();
        for (const c of raw) m.set(new Date(c.date).getTime(), c);
        histMap.set(pos.instrument_token, m);
      } catch {
        histMap.set(pos.instrument_token, new Map());
      }
      await new Promise((r) => setTimeout(r, 350)); // ~2.8 req/s
    }

    // Base exposure: |qty| × avg_entry_price
    const baseExposure = fno.reduce((s, p) => s + Math.abs(p.quantity) * p.average_price, 0);
    if (baseExposure === 0) return res.json({ series: [], stats: null });

    // Each instrument's 9:15 open price — used as the day-base for index calc
    const openPrice = new Map();
    for (const pos of fno) {
      const m = histMap.get(pos.instrument_token);
      const firstCandle = m && m.size > 0 ? [...m.values()][0] : null;
      openPrice.set(pos.instrument_token, firstCandle ? firstCandle.open : pos.average_price);
    }

    // Union of all timestamps in sorted order
    const allTimes = new Set();
    for (const m of histMap.values()) for (const t of m.keys()) allTimes.add(t);
    const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

    // Carry-forward latest close per instrument
    const latestClose = new Map();
    for (const pos of fno) latestClose.set(pos.instrument_token, openPrice.get(pos.instrument_token));

    // Build index time-series
    let dayHigh = 100, dayLow = 100;
    const series = sortedTimes.map((t) => {
      for (const pos of fno) {
        const candle = histMap.get(pos.instrument_token)?.get(t);
        if (candle) latestClose.set(pos.instrument_token, candle.close);
      }
      // index(t) = 100 + Σ[qty × (price(t) − open(9:15))] / baseExposure × 100
      const pnlFromOpen = fno.reduce((s, pos) => {
        const curr = latestClose.get(pos.instrument_token) ?? openPrice.get(pos.instrument_token);
        return s + pos.quantity * (curr - openPrice.get(pos.instrument_token));
      }, 0);
      const value = 100 + (pnlFromOpen / baseExposure) * 100;
      dayHigh = Math.max(dayHigh, value);
      dayLow  = Math.min(dayLow, value);
      return { time: t, value };
    });

    const current = series.length ? series[series.length - 1].value : 100;
    res.json({
      series,
      stats: {
        dayOpen: 100,
        dayHigh,
        dayLow,
        dayChange: current - 100,
        dayChangePct: current - 100,
        currentValue: current,
        baseExposure,
        positionCount: fno.length,
        dataPoints: series.length,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
