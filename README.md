# Make Your Index

A real-time, exposure-weighted custom index built on top of your live **Zerodha Kite** F&O positions. Think of it as your own personalised Nifty — starts at **100**, moves with your book, weighted by how much capital you've actually deployed in each leg.

---

## What It Does

| Feature | Detail |
|---|---|
| **Live F&O positions** | Reads your open NFO/BFO positions via Kite API every 5 seconds |
| **Exposure-weighted index** | Each leg is weighted by `\|qty\| × entry_price` — bigger bets move the index more |
| **Starts at 100** | Index anchors to 100 when you first connect (or when you hit Reset Base) |
| **Today's full history** | Downloads today's minute-by-minute OHLC for every instrument from Kite and reconstructs the index from 9:15 AM |
| **Multiple timeframes** | Live candles aggregated into 1m / 5m / 15m / 1h / 1D in-memory |
| **Line + Candlestick toggle** | Switch between a smooth area chart and a full OHLC candlestick chart (TradingView lightweight-charts) |
| **Grouped positions table** | Holdings grouped by underlying (NIFTY, BANKNIFTY, RELIANCE …), each showing FUT → CE → PE with individual weights and combined exposure |
| **Dynamic** | Add or exit a position — the index picks it up on the next poll automatically |

---

## Index Formula

```
Index(t) = 100 + [ ΣPnL(t) − BasePnL ] / BaseExposure × 100
```

| Term | Definition |
|---|---|
| `ΣPnL(t)` | Sum of Kite's reported P&L across all open F&O legs at time t |
| `BasePnL` | Total P&L at the moment the base was locked (first connect or Reset Base) |
| `BaseExposure` | `Σ \|qty_i\| × avg_entry_price_i` at base-lock time |

**Why this formula?**
- Kite's `pnl` field handles direction correctly — longs profit when price rises, shorts profit when price falls, no special-casing needed.
- Weighting by `|qty| × entry_price` reflects actual capital deployed — a ₹5,000 option premium and a ₹10,00,000 futures notional are treated very differently.
- Adding or exiting positions after the base is set naturally integrates into the index without resetting it.

**For the Today chart**, the formula is recalculated from scratch using Kite historical data:

```
Index(t) = 100 + Σ[ qty_i × (price_i(t) − open_i(9:15)) ] / BaseExposure × 100
```

This anchors the index precisely at 100 at market open (9:15 AM IST) regardless of when you entered your positions.

---

## Tech Stack

```
Make_your_Index/
├── backend/            Node.js + Express
│   └── server.js       KiteConnect, index logic, candle aggregation, historical API
└── frontend/           React 18 + TypeScript + Vite
    └── src/
        ├── App.tsx                  Dashboard shell, polling, stats cards
        ├── components/
        │   ├── AuthPanel.tsx        OAuth flow + manual token entry
        │   ├── IndexChart.tsx       Line/Candle toggle, timeframe selector, TODAY mode
        │   ├── CandleChart.tsx      TradingView lightweight-charts v5 wrapper
        │   └── PositionsTable.tsx   Grouped F&O table with weight bars
        └── types.ts                 Shared TypeScript interfaces
```

**Key dependencies**

| Package | Purpose |
|---|---|
| `kiteconnect` | Official Zerodha KiteConnect Node.js SDK |
| `express` + `cors` | REST API server |
| `react` + `vite` | Frontend framework + build tool |
| `recharts` | Line/area chart for live timeframes |
| `lightweight-charts` | TradingView's candlestick chart (v5) |
| `axios` | Frontend HTTP client |

---

## Prerequisites

1. **Zerodha Kite Developer account** — [developers.kite.trade](https://developers.kite.trade)
2. Create an app, note your **API Key** and **API Secret**
3. Set **Redirect URL** to `http://127.0.0.1:5173/` in your Kite app settings
4. Node.js 18+

---

## Setup & Run

### 1. Clone

```bash
git clone https://github.com/aayushcodex17/Make_your_Index.git
cd Make_your_Index
```

### 2. Configure backend

```bash
cd backend
cp .env.example .env
```

Open `.env` and fill in:

```env
KITE_API_KEY=your_api_key_here
KITE_API_SECRET=your_api_secret_here
PORT=3001
```

### 3. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 4. Start both servers

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev
# → Backend running on http://localhost:3001
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
# → Vite dev server on http://localhost:5173
```

Open **http://localhost:5173**.

---

## Authentication

### OAuth Flow (recommended)

1. Click **"Login with Kite →"** — Zerodha login opens in a new tab
2. Enter credentials + 2FA
3. After login, Zerodha redirects back. The URL will look like:
   ```
   http://127.0.0.1:5173/?request_token=XXXXXXXXXXXXXXXX&action=login&status=success
   ```
4. Copy the `request_token` value from the URL
5. Paste it in the input and click **"Authenticate"**

The backend exchanges `request_token` + `api_secret` → `access_token` (valid until midnight IST).

> `request_token` is single-use and expires within a few minutes. You need a fresh one each trading day.

### Manual Token

Already have a valid `access_token`? Switch to the **Manual Token** tab, paste it, click **Connect**.

---

## Dashboard Guide

### Stats Cards

| Card | What it shows |
|---|---|
| **Index Value** | Current level + point change from base |
| **Total Return** | % return vs. base (100) |
| **Total P&L** | Sum of all open F&O leg P&Ls in ₹ |
| **Total Exposure** | Combined `\|qty\| × entry_price` across all legs |
| **Positions** | Number of active F&O legs |

### Chart — Timeframes

| Button | Data source |
|---|---|
| `TODAY` | Fetches today's full minute history from Kite (9:15 AM → now). Takes a few seconds proportional to number of positions. |
| `1m` | In-memory candles built from 5s polls — last ~6.5 hours |
| `5m` | Aggregated from same polls — last ~33 hours |
| `15m` | Last ~4 days |
| `1h` | Last ~16 days |
| `1D` | All-time daily candles since server started |

### Chart — Line vs Candlestick

Toggle at the top-right of the chart:

| Mode | Description |
|---|---|
| `📈 Line` | Smooth area chart with gradient fill (Recharts) |
| `🕯 Candle` | Full OHLC candlestick (TradingView lightweight-charts). Green body = bullish close, red = bearish. Wicks show intra-period high/low. Fully interactive — crosshair, zoom, scroll. |

**TODAY + Candle** — a sub-picker (`1m · 5m · 15m`) appears to control candle resolution. Candles are aggregated from the minute data; each candle's open equals the previous minute's close for continuity.

The **blue dashed line at 100** marks the index base on all views.

### Positions Table

Positions are grouped by underlying, sorted by total weight (largest first).

**Group header row** (click to collapse/expand):
- Underlying name + leg count
- Combined total exposure in ₹
- Aggregated weight bar
- Combined P&L and P&L %

**Leg rows** (always ordered FUT → CE → PE, then by strike):
- Instrument type badge (FUT / CE / PE) and Side badge (LONG / SHORT)
- Entry price, LTP (coloured green/red vs entry)
- Individual exposure, weight bar, P&L

### Reset Base

**⟳ Reset Base** button (header, amber) — re-anchors the index to 100 at the current portfolio state and clears all in-memory candle history. Use this to track performance from a specific moment, e.g. right after entering a new trade.

---

## How Candles Are Built

### Live timeframes

Every 5 seconds the server polls Kite positions and computes the current index value. It is bucketed into OHLC candles per timeframe:

| Field | Value |
|---|---|
| **Open** | First index value in the time bucket |
| **High** | Maximum index value seen in the bucket |
| **Low** | Minimum index value seen in the bucket |
| **Close** | Most recent index value in the bucket |

400 candles per timeframe are kept in memory.

### TODAY

`getHistoricalData` is called once per active instrument at `minute` resolution for today's session. The index is reconstructed at every minute timestamp using carry-forward pricing for any missing bars (illiquid options with sparse data).

Kite rate limit (3 req/s) is respected with a 350ms delay between instrument requests.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/status` | Check if a session is active |
| `GET` | `/api/login-url` | Get the Kite OAuth login URL |
| `POST` | `/api/auth` | Exchange `requestToken` → access token |
| `POST` | `/api/set-token` | Set access token manually |
| `GET` | `/api/snapshot` | Current index value, positions, live candles |
| `GET` | `/api/today` | Full-day minute index series + day stats (high, low, change) |
| `POST` | `/api/reset-base` | Re-anchor index to 100 at current portfolio state |

---

## Limitations & Known Behaviour

- **In-memory only** — candle history and the base reset on server restart. No database persistence yet.
- **Market hours** — 5s polling is only meaningful during NSE/BSE trading hours (9:15 AM – 3:30 PM IST). Outside hours, prices are stale.
- **Access token expiry** — Kite tokens expire at midnight each day. Re-authenticate each morning.
- **TODAY load time** — proportional to number of positions: ~0.35s per instrument. 10 positions ≈ 3.5s.
- **Sparse option data** — Deep OTM or newly listed options may have gaps in historical data; the last known price is carried forward.
- **Index after position exit** — When you close a position, it disappears from `getPositions().net`. Its historical P&L contribution remains locked in `BasePnL`, so the index correctly reflects your realised + unrealised performance.

---

## License

MIT
