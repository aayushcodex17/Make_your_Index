const express = require('express');
const cors = require('cors');
const { KiteConnect } = require('kiteconnect');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });

// In-memory store
let accessToken = null;
let basePortfolioValue = null;
let indexHistory = [];

// ── Auth ────────────────────────────────────────────────────────────────────

app.get('/api/login-url', (_req, res) => {
  res.json({ url: kite.getLoginURL() });
});

app.post('/api/auth', async (req, res) => {
  try {
    const { requestToken } = req.body;
    const session = await kite.generateSession(requestToken, process.env.KITE_API_SECRET);
    accessToken = session.access_token;
    kite.setAccessToken(accessToken);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Allow manual token injection (for dev / persistent sessions)
app.post('/api/set-token', (req, res) => {
  const { token } = req.body;
  accessToken = token;
  kite.setAccessToken(token);
  res.json({ success: true });
});

// ── Index logic ──────────────────────────────────────────────────────────────

function calcIndexSnapshot(holdings) {
  const totalCost = holdings.reduce((s, h) => s + h.average_price * h.quantity, 0);
  const currentValue = holdings.reduce((s, h) => s + h.last_price * h.quantity, 0);

  const positions = holdings.map((h) => {
    const cost = h.average_price * h.quantity;
    const value = h.last_price * h.quantity;
    return {
      symbol: h.tradingsymbol,
      exchange: h.exchange,
      quantity: h.quantity,
      avgPrice: h.average_price,
      lastPrice: h.last_price,
      exposure: cost,
      currentValue: value,
      weight: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      pnl: value - cost,
      pnlPct: h.average_price > 0 ? ((h.last_price - h.average_price) / h.average_price) * 100 : 0,
    };
  });

  return { positions, totalCost, currentValue };
}

app.get('/api/snapshot', async (_req, res) => {
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const holdings = await kite.getHoldings();

    if (!holdings.length) return res.json({ positions: [], indexValue: 100, indexHistory });

    const { positions, totalCost, currentValue } = calcIndexSnapshot(holdings);

    // Lock base on first call
    if (basePortfolioValue === null) basePortfolioValue = currentValue;

    const indexValue = (currentValue / basePortfolioValue) * 100;

    indexHistory.push({ time: new Date().toISOString(), value: indexValue });
    if (indexHistory.length > 2000) indexHistory.shift();

    res.json({ positions, indexValue, totalCost, currentValue, indexHistory });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reset index base to current portfolio value → index resets to 100
app.post('/api/reset-base', async (_req, res) => {
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const holdings = await kite.getHoldings();
    const currentValue = holdings.reduce((s, h) => s + h.last_price * h.quantity, 0);
    basePortfolioValue = currentValue;
    indexHistory = [{ time: new Date().toISOString(), value: 100 }];
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/status', (_req, res) => {
  res.json({ authenticated: !!accessToken });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
