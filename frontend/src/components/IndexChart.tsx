import { useState, useCallback } from 'react';
import axios from 'axios';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, ReferenceLine,
} from 'recharts';
import { Candle, Timeframe, TodayData, TodayPoint } from '../types';

interface Props {
  candles: Record<Exclude<Timeframe, 'TODAY'>, Candle[]>;
  currentValue: number;
}

const LIVE_TFS: Exclude<Timeframe, 'TODAY'>[] = ['1m', '5m', '15m', '1h', '1D'];

function fmtTime(epoch: number, tf: Timeframe) {
  const d = new Date(epoch);
  if (tf === '1D') return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

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
      <div style={{ ...ttMono, fontSize: 18, fontWeight: 700, color: p.value >= 100 ? '#22c55e' : '#ef4444' }}>
        {p.value.toFixed(2)}
      </div>
      <div style={{ fontSize: 12, color: diff >= 0 ? '#22c55e' : '#ef4444' }}>
        {diff >= 0 ? '+' : ''}{diff.toFixed(2)} pts ({((diff / 100) * 100).toFixed(2)}%)
      </div>
    </div>
  );
};

export default function IndexChart({ candles, currentValue }: Props) {
  const [tf, setTf] = useState<Timeframe>('1m');
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [todayLoading, setTodayLoading] = useState(false);
  const [todayError, setTodayError] = useState('');

  const fetchToday = useCallback(async () => {
    setTodayLoading(true);
    setTodayError('');
    try {
      const { data } = await axios.get<TodayData>('/api/today');
      setTodayData(data);
    } catch (e: any) {
      setTodayError(e.response?.data?.error || 'Failed to fetch today\'s data');
    } finally {
      setTodayLoading(false);
    }
  }, []);

  function handleTfClick(t: Timeframe) {
    setTf(t);
    if (t === 'TODAY' && !todayData && !todayLoading) fetchToday();
  }

  const isToday = tf === 'TODAY';
  const liveData = !isToday ? (candles[tf as Exclude<Timeframe, 'TODAY'>] ?? []) : [];
  const color = currentValue >= 100 ? '#22c55e' : '#ef4444';
  const todayColor = todayData?.stats
    ? (todayData.stats.currentValue >= 100 ? '#22c55e' : '#ef4444')
    : '#6366f1';

  return (
    <div style={{ background: '#151820', border: '1px solid #262c3d', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid #1e2230',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>Index Performance</span>
          {isToday && todayData?.stats && (
            <div style={{ display: 'flex', gap: 16 }}>
              <Stat label="Day High" value={todayData.stats.dayHigh.toFixed(2)} color="#22c55e" />
              <Stat label="Day Low"  value={todayData.stats.dayLow.toFixed(2)}  color="#ef4444" />
              <Stat
                label="Day Change"
                value={`${todayData.stats.dayChange >= 0 ? '+' : ''}${todayData.stats.dayChange.toFixed(2)} pts`}
                color={todayData.stats.dayChange >= 0 ? '#22c55e' : '#ef4444'}
              />
              <Stat label="Candles" value={String(todayData.stats.dataPoints)} />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {/* TODAY tab — distinct */}
          <button
            onClick={() => handleTfClick('TODAY')}
            style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: tf === 'TODAY' ? '#f59e0b' : '#1e2230',
              color: tf === 'TODAY' ? '#000' : '#64748b',
              fontSize: 12, fontWeight: 600,
              marginRight: 6,
            }}
          >TODAY</button>
          {LIVE_TFS.map((t) => (
            <button key={t} onClick={() => handleTfClick(t)} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: tf === t ? '#6366f1' : '#1e2230',
              color: tf === t ? '#fff' : '#64748b',
              fontSize: 12, fontWeight: tf === t ? 600 : 400,
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Chart body */}
      {isToday ? (
        todayLoading ? (
          <div style={placeholder}>
            <Spinner />
            <span style={{ marginTop: 12, color: '#475569', fontSize: 13 }}>
              Fetching historical data from Kite…
            </span>
          </div>
        ) : todayError ? (
          <div style={{ ...placeholder, color: '#ef4444' }}>{todayError}
            <button onClick={fetchToday} style={{ marginTop: 12, ...retryBtn }}>Retry</button>
          </div>
        ) : !todayData?.series.length ? (
          <div style={placeholder}>
            <span style={{ color: '#475569' }}>No historical data returned</span>
            <button onClick={fetchToday} style={{ marginTop: 12, ...retryBtn }}>Retry</button>
          </div>
        ) : (
          <div style={{ padding: '16px 8px 12px 0' }}>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={todayData.series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="todayGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={todayColor} stopOpacity={0.22} />
                    <stop offset="95%" stopColor={todayColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2230" vertical={false} />
                <XAxis
                  dataKey="time"
                  tickFormatter={(v) => fmtTime(v, 'TODAY')}
                  tick={{ fill: '#475569', fontSize: 11 }}
                  axisLine={false} tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => v.toFixed(1)}
                  tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={false} tickLine={false} width={62}
                />
                <ReferenceLine y={100} stroke="#3b82f6" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'Open 100', fill: '#3b82f6', fontSize: 10, position: 'insideTopLeft' }} />
                <Tooltip content={<TodayTooltip />} />
                <Area
                  type="monotone" dataKey="value"
                  stroke={todayColor} strokeWidth={2}
                  fill="url(#todayGrad)" dot={false}
                  activeDot={{ r: 4, fill: todayColor, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )
      ) : liveData.length < 2 ? (
        <div style={placeholder}>
          <span style={{ color: '#475569' }}>Collecting live data — refreshes every 5s</span>
        </div>
      ) : (
        <div style={{ padding: '16px 8px 12px 0' }}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={liveData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="liveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2230" vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={(v) => fmtTime(v, tf)}
                tick={{ fill: '#475569', fontSize: 11 }}
                axisLine={false} tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={['auto', 'auto']}
                tickFormatter={(v) => v.toFixed(1)}
                tick={{ fill: '#475569', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                axisLine={false} tickLine={false} width={62}
              />
              <ReferenceLine y={100} stroke="#3b82f6" strokeDasharray="4 4" strokeOpacity={0.5} />
              <Tooltip content={<LiveTooltip tf={tf} />} />
              <Area
                type="monotone" dataKey="close"
                stroke={color} strokeWidth={2}
                fill="url(#liveGrad)" dot={false}
                activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Mini components ───────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600, color: color ?? '#94a3b8' }}>{value}</span>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%',
      border: '3px solid #262c3d', borderTopColor: '#6366f1',
      animation: 'spin 0.8s linear infinite',
    }} />
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const ttBox: React.CSSProperties = {
  background: '#1e2230', border: '1px solid #262c3d',
  borderRadius: 8, padding: '10px 14px', minWidth: 150,
};
const ttTime: React.CSSProperties = { color: '#64748b', fontSize: 11, marginBottom: 6 };
const ttMono: React.CSSProperties = { fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0' };
const placeholder: React.CSSProperties = {
  height: 280, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
};
const retryBtn: React.CSSProperties = {
  background: '#1e2230', border: '1px solid #262c3d', borderRadius: 6,
  padding: '6px 14px', color: '#94a3b8', fontSize: 12, cursor: 'pointer',
};
