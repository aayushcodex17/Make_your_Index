const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const Database   = require('better-sqlite3');
const { KiteConnect, KiteTicker } = require('kiteconnect');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });

// ── SQLite setup ──────────────────────────────────────────────────────────────
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'index.db'));
db.pragma('journal_mode = WAL');  // better concurrent read performance

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key        TEXT PRIMARY KEY,
    value      REAL    NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS candles (
    timeframe TEXT    NOT NULL,
    time      INTEGER NOT NULL,
    open      REAL    NOT NULL,
    high      REAL    NOT NULL,
    low       REAL    NOT NULL,
    close     REAL    NOT NULL,
    PRIMARY KEY (timeframe, time)
  );

  CREATE INDEX IF NOT EXISTS idx_candles_tf_time ON candles(timeframe, time);
`);

// Prepared statements
const stmts = {
  getConfig:    db.prepare('SELECT value FROM config WHERE key = ?'),
  setConfig:    db.prepare('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, unixepoch())'),
  upsertCandle: db.prepare('INSERT OR REPLACE INTO candles VALUES (?,?,?,?,?,?)'),
  loadCandles:  db.prepare('SELECT time, open, high, low, close FROM candles WHERE timeframe = ? ORDER BY time ASC'),
  deleteCandles:db.prepare('DELETE FROM candles'),
  deleteOldCandles: db.prepare(`
    DELETE FROM candles WHERE timeframe = ? AND time NOT IN (
      SELECT time FROM candles WHERE timeframe = ? ORDER BY time DESC LIMIT ?
    )
  `),
};

// ── In-memory state ───────────────────────────────────────────────────────────
let accessToken    = null;
let basePnl        = null;
let baseExposure   = null;
let baseSetAt      = null;

const TF = {
  '1m':  { ms: 60_000,     max: 400 },
  '5m':  { ms: 300_000,    max: 400 },
  '15m': { ms: 900_000,    max: 400 },
  '1h':  { ms: 3_600_000,  max: 400 },
  '1D':  { ms: 86_400_000, max: 400 },
};
const candles = { '1m': [], '5m': [], '15m': [], '1h': [], '1D': [] };

let activePositions = [];
const tickState     = new Map();
let ticker          = null;
let posRefreshTimer = null;
const sseClients    = new Set();

// ── DB: load & save ───────────────────────────────────────────────────────────
function loadFromDB() {
  const bpRow  = stmts.getConfig.get('base_pnl');
  const beRow  = stmts.getConfig.get('base_exposure');
  const batRow = stmts.getConfig.get('base_set_at');

  basePnl      = bpRow  ? bpRow.value  : null;
  baseExposure = beRow  ? beRow.value  : null;
  baseSetAt    = batRow ? batRow.value : null;

  // Load persisted candles
  for (const [tf, { max }] of Object.entries(TF)) {
    const rows = stmts.loadCandles.all(tf);
    candles[tf] = rows.slice(-max); // only keep last `max` candles
  }

  const totalCandles = Object.values(candles).reduce((s, a) => s + a.length, 0);
  console.log(`DB loaded — basePnl: ${basePnl?.toFixed(2) ?? 'unset'}, baseExposure: ${baseExposure?.toFixed(2) ?? 'unset'}, candles: ${totalCandles}`);
}

function saveBaseConfig() {
  const now = Math.floor(Date.now() / 1000);
  if (basePnl      !== null) stmts.setConfig.run('base_pnl',      basePnl,      now);
  if (baseExposure !== null) stmts.setConfig.run('base_exposure',  baseExposure, now);
  if (baseSetAt    !== null) stmts.setConfig.run('base_set_at',    baseSetAt,    now);
}

// Batch-upsert all in-memory candles (called periodically + on new bucket)
const flushCandles = db.transaction(() => {
  for (const [tf, arr] of Object.entries(candles)) {
    for (const c of arr) {
      stmts.upsertCandle.run(tf, c.time, c.open, c.high, c.low, c.close);
    }
    // Trim old rows beyond max
    stmts.deleteOldCandles.run(tf, tf, TF[tf].max);
  }
});

let candlesDirty = false;

// Flush dirty candles every 60 seconds
setInterval(() => {
  if (candlesDirty) {
    flushCandles();
    candlesDirty = false;
  }
}, 60_000);

// ── Instrument parser ─────────────────────────────────────────────────────────
function parseInstrument(symbol) {
  if (symbol.endsWith('FUT')) {
    const body  = symbol.slice(0, -3);
    const match = body.match(/\d{2}[A-Z]{3}/);
    const expiry = match ? match[0] : '';
    return { underlying: body.replace(expiry, ''), expiry, type: 'FUT', strike: null };
  }
  const optType = symbol.endsWith('CE') ? 'CE' : symbol.endsWith('PE') ? 'PE' : null;
  if (optType) {
    const body  = symbol.slice(0, -2);
    const match = body.match(/\d{2}[A-Z]{3}/);
    const expiry = match ? match[0] : '';
    const idx   = body.indexOf(expiry);
    return {
      underlying: body.slice(0, idx),
      expiry,
      type: optType,
      strike: parseFloat(body.slice(idx + expiry.length)) || null,
    };
  }
  return { underlying: symbol, expiry: '', type: 'UNKNOWN', strike: null };
}

// ── Candle aggregation ────────────────────────────────────────────────────────
function pushCandle(indexValue) {
  const now = Date.now();
  for (const [tf, { ms, max }] of Object.entries(TF)) {
    const bucket = Math.floor(now / ms) * ms;
    const arr    = candles[tf];
    const last   = arr[arr.length - 1];

    if (last && last.time === bucket) {
      last.high  = Math.max(last.high, indexValue);
      last.low   = Math.min(last.low,  indexValue);
      last.close = indexValue;
    } else {
      const candle = { time: bucket, open: indexValue, high: indexValue, low: indexValue, close: indexValue };
      arr.push(candle);
      if (arr.length > max) arr.shift();
      // New bucket → persist immediately
      stmts.upsertCandle.run(tf, bucket, indexValue, indexValue, indexValue, indexValue);
    }
    candlesDirty = true;
  }
}

// ── Index calculation (tick-adjusted) ────────────────────────────────────────
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
    const pnl      = ts.restPnl + p.quantity * (ts.ltp - ts.restLtp);
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
      weight:  totalExposure > 0 ? (exposure / totalExposure) * 100 : 0,
      pnl,
      pnlPct:  exposure > 0 ? (pnl / exposure) * 100 : 0,
      side:    p.quantity > 0 ? 'LONG' : 'SHORT',
    };
  });

  const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);

  // Lock base on first-ever calculation (no DB record yet)
  if (basePnl === null) {
    basePnl      = totalPnl;
    baseExposure = totalExposure;
    baseSetAt    = Date.now();
    saveBaseConfig();
    console.log(`Base locked — pnl: ${basePnl.toFixed(2)}, exposure: ${baseExposure.toFixed(2)}`);
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
    basePnl: basePnl ?? 0,
    baseExposure: baseExposure ?? 0,
    baseSetAt,
    candles,
  });
  for (const client of sseClients) client.write(`data: ${payload}\n\n`);
}

// ── KiteTicker ────────────────────────────────────────────────────────────────
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
        ts.ltp  = tick.last_price;
        changed = true;
      }
    }
    if (changed) broadcast();
  });

  ticker.on('disconnect', (err) => {
    console.log('KiteTicker disconnected:', err?.message ?? '');
    if (accessToken) setTimeout(startTicker, 3000);
  });

  ticker.on('error', (err) => console.error('KiteTicker error:', err?.message));
  ticker.connect();
}

// ── Position refresh (REST every 15s) ────────────────────────────────────────
async function refreshPositions() {
  if (!accessToken) return;
  try {
    const all = await kite.getPositions();
    const fno = (all.net || []).filter(
      (p) => (p.exchange === 'NFO' || p.exchange === 'BFO') && p.quantity !== 0
    );

    const prevTokens = new Set(activePositions.map((p) => p.instrument_token));
    const newTokens  = new Set(fno.map((p) => p.instrument_token));

    for (const p of fno) {
      const existing = tickState.get(p.instrument_token);
      tickState.set(p.instrument_token, {
        ltp:     existing?.ltp ?? p.last_price,
        restLtp: p.last_price,
        restPnl: p.pnl,
      });
    }
    for (const t of tickState.keys()) {
      if (!newTokens.has(t)) tickState.delete(t);
    }

    activePositions = fno;

    const tokensChanged =
      [...prevTokens].some((t) => !newTokens.has(t)) ||
      [...newTokens].some((t) => !prevTokens.has(t));

    if (ticker && tokensChanged) {
      const tokens = fno.map((p) => p.instrument_token);
      if (tokens.length) subscribeTicker(tokens);
    }

    broadcast();
  } catch (err) {
    console.error('Position refresh error:', err.message);
  }
}

// ── Session start ─────────────────────────────────────────────────────────────
async function startSession() {
  if (posRefreshTimer) clearInterval(posRefreshTimer);
  await refreshPositions();
  posRefreshTimer = setInterval(refreshPositions, 15_000);
  startTicker();
}

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

// ── SSE stream ────────────────────────────────────────────────────────────────
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const { positions, indexValue, totalExposure, totalPnl } = calcIndexFromTicks();
  res.write(`data: ${JSON.stringify({
    positions, indexValue, totalExposure, totalPnl,
    basePnl: basePnl ?? 0, baseExposure: baseExposure ?? 0,
    baseSetAt, candles,
  })}\n\n`);

  sseClients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { sseClients.delete(res); clearInterval(ping); });
});

// ── Snapshot (manual refresh) ─────────────────────────────────────────────────
app.get('/api/snapshot', async (_req, res) => {
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    await refreshPositions();
    const { positions, indexValue, totalExposure, totalPnl } = calcIndexFromTicks();
    res.json({ positions, indexValue, totalExposure, totalPnl, basePnl, baseExposure, baseSetAt, candles });
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
    baseSetAt    = Date.now();
    saveBaseConfig();

    // Clear candle history
    stmts.deleteCandles.run();
    for (const tf of Object.keys(candles)) candles[tf] = [];
    pushCandle(100);
    flushCandles();
    broadcast();

    res.json({ success: true, baseSetAt });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── DB info endpoint ──────────────────────────────────────────────────────────
app.get('/api/db-info', (_req, res) => {
  const totalCandles = Object.values(candles).reduce((s, a) => s + a.length, 0);
  res.json({
    basePnl,
    baseExposure,
    baseSetAt,
    baseSetAtFormatted: baseSetAt ? new Date(baseSetAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : null,
    totalCandles,
    candlesByTf: Object.fromEntries(Object.entries(candles).map(([tf, a]) => [tf, a.length])),
  });
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

// ── Boot ──────────────────────────────────────────────────────────────────────
loadFromDB();   // restore persisted state before accepting requests

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
