import { useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis, ReferenceLine,
} from 'recharts';
import { Candle, Timeframe } from '../types';

interface Props {
  candles: Record<Timeframe, Candle[]>;
  currentValue: number;
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '1D'];

function fmtTime(epoch: number, tf: Timeframe) {
  const d = new Date(epoch);
  if (tf === '1D') return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

const CustomTooltip = ({ active, payload, tf }: any) => {
  if (!active || !payload?.length) return null;
  const c: Candle = payload[0].payload;
  const diff = c.close - 100;
  return (
    <div style={{
      background: '#1e2230', border: '1px solid #262c3d',
      borderRadius: 8, padding: '10px 14px', minWidth: 160,
    }}>
      <div style={{ color: '#64748b', fontSize: 11, marginBottom: 6 }}>
        {fmtTime(c.time, tf)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px', fontSize: 12 }}>
        <span style={{ color: '#64748b' }}>O</span>
        <span style={{ fontFamily: 'JetBrains Mono', color: '#e2e8f0' }}>{c.open.toFixed(2)}</span>
        <span style={{ color: '#22c55e' }}>H</span>
        <span style={{ fontFamily: 'JetBrains Mono', color: '#22c55e' }}>{c.high.toFixed(2)}</span>
        <span style={{ color: '#ef4444' }}>L</span>
        <span style={{ fontFamily: 'JetBrains Mono', color: '#ef4444' }}>{c.low.toFixed(2)}</span>
        <span style={{ color: '#64748b' }}>C</span>
        <span style={{ fontFamily: 'JetBrains Mono', color: c.close >= 100 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
          {c.close.toFixed(2)}
        </span>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: diff >= 0 ? '#22c55e' : '#ef4444' }}>
        {diff >= 0 ? '+' : ''}{diff.toFixed(2)} pts
      </div>
    </div>
  );
};

export default function IndexChart({ candles, currentValue }: Props) {
  const [tf, setTf] = useState<Timeframe>('1m');
  const color = currentValue >= 100 ? '#22c55e' : '#ef4444';
  const data = candles[tf] ?? [];

  return (
    <div style={{ background: '#151820', border: '1px solid #262c3d', borderRadius: 12, overflow: 'hidden' }}>
      {/* Timeframe selector */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid #1e2230',
      }}>
        <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>
          Index Performance
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {TIMEFRAMES.map((t) => (
            <button key={t} onClick={() => setTf(t)} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: tf === t ? '#6366f1' : '#1e2230',
              color: tf === t ? '#fff' : '#64748b',
              fontSize: 12, fontWeight: tf === t ? 600 : 400,
              transition: 'all 0.15s',
            }}>{t}</button>
          ))}
        </div>
      </div>

      {data.length < 2 ? (
        <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
          Collecting data — refresh in a moment
        </div>
      ) : (
        <div style={{ padding: '16px 8px 12px 0' }}>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
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
              <Tooltip content={<CustomTooltip tf={tf} />} />
              <Area
                type="monotone" dataKey="close"
                stroke={color} strokeWidth={2}
                fill="url(#grad)" dot={false}
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
