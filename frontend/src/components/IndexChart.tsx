import { useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, ReferenceLine,
} from 'recharts';
import { Candle, Timeframe, TodayData, TodayPoint } from '../types';
import CandleChart from './CandleChart';

interface Props {
  candles: Record<Exclude<Timeframe, 'TODAY'>, Candle[]>;
  currentValue: number;
}

type ChartMode = 'line' | 'candle';

const LIVE_TFS: Exclude<Timeframe, 'TODAY'>[] = ['1m', '5m', '15m', '1h', '1D'];

// Candle resolution options for TODAY mode (aggregated from minute data)
const TODAY_CANDLE_RES: { label: string; ms: number }[] = [
  { label: '1m',  ms: 60_000 },
  { label: '5m',  ms: 300_000 },
  { label: '15m', ms: 900_000 },
];

// Aggregate minute index series into OHLC candles
function toOHLC(series: TodayPoint[], bucketMs: number): Candle[] {
  if (!series.length) return [];
  const map = new Map<number, Candle>();
  let prevValue = series[0].value;

  for (const p of series) {
    const bucket = Math.floor(p.time / bucketMs) * bucketMs;
    if (!map.has(bucket)) {
      map.set(bucket, {
        time: bucket,
        open: prevValue,
        high: Math.max(prevValue, p.value),
        low: Math.min(prevValue, p.value),
        close: p.value,
      });
    } else {
      const c = map.get(bucket)!;
      c.high = Math.max(c.high, p.value);
      c.low  = Math.min(c.low,  p.value);
      c.close = p.value;
    }
    prevValue = p.value;
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function fmtTime(epoch: number, tf: Timeframe) {
  const d = new Date(epoch);
  if (tf === '1D') return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ── Tooltips ─────────────────────────────────────────────────────────────────

const LiveTooltip = ({ active, payload, tf }: any) => {
  if (!active || !payload?.length) return null;
  const c: Candle = payload[0].payload;
  const diff = c.close - 100;
  return (
    <div style={ttBox}>
      <div style={ttTime}>{fmtTime(c.time, tf)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px', fontSize: 12 }}>
        <span style={{ color: '#64748b' }}>O</span><span style={ttMono}>{c.open.toFixed(2)}</span>
        <span style={{ color: '#22c55e' }}>H</span><span style={{ ...ttMono, color: '#22c55e' }}>{c.high.toFixed(2)}</span>
        <span style={{ color: '#ef4444' }}>L</span><span style={{ ...ttMono, color: '#ef4444' }}>{c.low.toFixed(2)}</span>
        <span style={{ color: '#64748b' }}>C</span>
        <span style={{ ...ttMono, color: c.close >= 100 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{c.close.toFixed(2)}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: diff >= 0 ? '#22c55e' : '#ef4444' }}>
        {diff >= 0 ? '+' : ''}{diff.toFixed(2)} pts
      </div>
    </div>
  );
};

const TodayTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p: TodayPoint = payload[0].payload;
  const diff = p.value - 100;
  return (
    <div style={ttBox}>
      <div style={ttTime}>{fmtTime(p.time, 'TODAY')}</div>
      <div style={{ ...ttMono, fontSize: 17, fontWeight: 700, color: p.value >= 100 ? '#22c55e' : '#ef4444' }}>
        {p.value.toFixed(2)}
      </div>
      <div style={{ fontSize: 12, color: diff >= 0 ? '#22c55e' : '#ef4444' }}>
        {diff >= 0 ? '+' : ''}{diff.toFixed(2)} pts ({((diff / 100) * 100).toFixed(2)}%)
      </div>
    </div>
  );
};

// ── Main chart component ──────────────────────────────────────────────────────

export default function IndexChart({ candles, currentValue }: Props) {
  const [tf, setTf]             = useState<Timeframe>('1m');
  const [mode, setMode]         = useState<ChartMode>('line');
  const [todayData, setTodayData]     = useState<TodayData | null>(null);
  const [todayLoading, setTodayLoading] = useState(false);
  const [todayError, setTodayError]   = useState('');
  const [todayCandleRes, setTodayCandleRes] = useState(TODAY_CANDLE_RES[0]);

  const fetchToday = useCallback(async () => {
    setTodayLoading(true);
    setTodayError('');
    try {
      const { data } = await axios.get<TodayData>('/api/today');
      setTodayData(data);
    } catch (e: any) {
      setTodayError(e.response?.data?.error || "Failed to fetch today's data");
    } finally {
      setTodayLoading(false);
    }
  }, []);

  function handleTfClick(t: Timeframe) {
    setTf(t);
    if (t === 'TODAY' && !todayData && !todayLoading) fetchToday();
  }

  const isToday = tf === 'TODAY';
  const liveCandles = !isToday ? (candles[tf as Exclude<Timeframe, 'TODAY'>] ?? []) : [];
  const lineColor = currentValue >= 100 ? '#22c55e' : '#ef4444';
  const todayColor = todayData?.stats
    ? (todayData.stats.currentValue >= 100 ? '#22c55e' : '#ef4444')
    : '#6366f1';

  // Candle data for candlestick mode
  const candleData: Candle[] = useMemo(() => {
    if (isToday) {
      return todayData?.series ? toOHLC(todayData.series, todayCandleRes.ms) : [];
    }
    return liveCandles;
  }, [isToday, todayData, todayCandleRes, liveCandles]);

  return (
    <div style={{ background: '#151820', border: '1px solid #262c3d', borderRadius: 12, overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 16px', borderBottom: '1px solid #1e2230', gap: 12, flexWrap: 'wrap',
      }}>

        {/* Left: today stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 12, color: '#475569', fontWeight: 500, whiteSpace: 'nowrap' }}>
            Index Performance
          </span>
          {isToday && todayData?.stats && (
            <>
              <MiniStat label="H" value={todayData.stats.dayHigh.toFixed(2)} color="#22c55e" />
              <MiniStat label="L" value={todayData.stats.dayLow.toFixed(2)}  color="#ef4444" />
              <MiniStat
                label="Chg"
                value={`${todayData.stats.dayChange >= 0 ? '+' : ''}${todayData.stats.dayChange.toFixed(2)} pts`}
                color={todayData.stats.dayChange >= 0 ? '#22c55e' : '#ef4444'}
              />
              <MiniStat label="Bars" value={String(todayData.stats.dataPoints)} />
            </>
          )}
        </div>

        {/* Right: controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>

          {/* TODAY candle resolution (only when TODAY + candle) */}
          {isToday && mode === 'candle' && (
            <div style={{ display: 'flex', gap: 3, marginRight: 4 }}>
              {TODAY_CANDLE_RES.map((r) => (
                <button key={r.label} onClick={() => setTodayCandleRes(r)} style={{
                  padding: '3px 9px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: todayCandleRes.ms === r.ms ? '#f59e0b22' : '#1e2230',
                  color: todayCandleRes.ms === r.ms ? '#f59e0b' : '#475569',
                  fontSize: 11, fontWeight: 600,
                }}>{r.label}</button>
              ))}
            </div>
          )}

          {/* Mode toggle */}
          <div style={{
            display: 'flex', background: '#1e2230', borderRadius: 7, padding: 2, gap: 2,
          }}>
            <ModeBtn active={mode === 'line'}   onClick={() => setMode('line')}   label="📈 Line" />
            <ModeBtn active={mode === 'candle'} onClick={() => setMode('candle')} label="🕯 Candle" />
          </div>

          {/* Timeframe buttons */}
          <div style={{ display: 'flex', gap: 3 }}>
            <button onClick={() => handleTfClick('TODAY')} style={{
              padding: '4px 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: tf === 'TODAY' ? '#f59e0b' : '#1e2230',
              color: tf === 'TODAY' ? '#000' : '#64748b',
              fontSize: 12, fontWeight: 600, marginRight: 3,
            }}>TODAY</button>
            {LIVE_TFS.map((t) => (
              <button key={t} onClick={() => handleTfClick(t)} style={{
                padding: '4px 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: tf === t ? '#6366f1' : '#1e2230',
                color: tf === t ? '#fff' : '#64748b',
                fontSize: 12, fontWeight: tf === t ? 600 : 400,
              }}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Chart body ── */}
      <div style={{ padding: mode === 'candle' ? '12px' : '16px 8px 12px 0' }}>
        {isToday ? (
          todayLoading ? (
            <LoadingState />
          ) : todayError ? (
            <ErrorState msg={todayError} onRetry={fetchToday} />
          ) : !todayData?.series.length ? (
            <ErrorState msg="No historical data returned" onRetry={fetchToday} />
          ) : mode === 'candle' ? (
            <CandleChart data={candleData} height={280} baseRef={100} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={todayData.series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="todayGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={todayColor} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={todayColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2230" vertical={false} />
                <XAxis dataKey="time" tickFormatter={(v) => fmtTime(v, 'TODAY')}
                  tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false}
                  interval="preserveStartEnd" />
                <YAxis domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(1)}
                  tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={false} tickLine={false} width={62} />
                <ReferenceLine y={100} stroke="#3b82f6" strokeDasharray="4 4" strokeOpacity={0.5}
                  label={{ value: 'open', fill: '#3b82f6', fontSize: 10, position: 'insideTopLeft' }} />
                <Tooltip content={<TodayTooltip />} />
                <Area type="monotone" dataKey="value" stroke={todayColor} strokeWidth={2}
                  fill="url(#todayGrad)" dot={false}
                  activeDot={{ r: 4, fill: todayColor, strokeWidth: 0 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )
        ) : mode === 'candle' ? (
          <CandleChart data={liveCandles} height={280} baseRef={100} />
        ) : liveCandles.length < 2 ? (
          <div style={emptyStyle}>Collecting live data — refreshes every 5s</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={liveCandles} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="liveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={lineColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2230" vertical={false} />
              <XAxis dataKey="time" tickFormatter={(v) => fmtTime(v, tf)}
                tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false}
                interval="preserveStartEnd" />
              <YAxis domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(1)}
                tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                axisLine={false} tickLine={false} width={62} />
              <ReferenceLine y={100} stroke="#3b82f6" strokeDasharray="4 4" strokeOpacity={0.5} />
              <Tooltip content={<LiveTooltip tf={tf} />} />
              <Area type="monotone" dataKey="close" stroke={lineColor} strokeWidth={2}
                fill="url(#liveGrad)" dot={false}
                activeDot={{ r: 4, fill: lineColor, strokeWidth: 0 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
      background: active ? '#151820' : 'transparent',
      color: active ? '#e2e8f0' : '#475569',
      fontSize: 12, fontWeight: active ? 600 : 400,
      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.4)' : 'none',
      transition: 'all 0.15s',
    }}>{label}</button>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: color ?? '#64748b' }}>{value}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ ...emptyStyle, flexDirection: 'column', gap: 12 }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%',
        border: '3px solid #262c3d', borderTopColor: '#6366f1',
        animation: 'spin 0.8s linear infinite',
      }} />
      <span style={{ color: '#475569', fontSize: 13 }}>Fetching historical data from Kite…</span>
    </div>
  );
}

function ErrorState({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div style={{ ...emptyStyle, flexDirection: 'column', gap: 12 }}>
      <span style={{ color: '#ef4444', fontSize: 13 }}>{msg}</span>
      <button onClick={onRetry} style={retryBtn}>Retry</button>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const emptyStyle: React.CSSProperties = {
  height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const ttBox: React.CSSProperties = {
  background: '#1e2230', border: '1px solid #262c3d', borderRadius: 8, padding: '10px 14px', minWidth: 150,
};
const ttTime: React.CSSProperties = { color: '#64748b', fontSize: 11, marginBottom: 6 };
const ttMono: React.CSSProperties = { fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0' };
const retryBtn: React.CSSProperties = {
  background: '#1e2230', border: '1px solid #262c3d', borderRadius: 6,
  padding: '6px 14px', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
};
