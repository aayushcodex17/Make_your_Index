import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from 'recharts';
import { IndexPoint } from '../types';

interface Props {
  history: IndexPoint[];
  currentValue: number;
}

function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const v: number = payload[0].value;
  const diff = v - 100;
  return (
    <div style={{
      background: '#1e2230',
      border: '1px solid #262c3d',
      borderRadius: 8,
      padding: '10px 14px',
    }}>
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>{payload[0].payload.time ? fmt(payload[0].payload.time) : ''}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 18, color: v >= 100 ? '#22c55e' : '#ef4444' }}>
        {v.toFixed(2)}
      </div>
      <div style={{ fontSize: 12, color: diff >= 0 ? '#22c55e' : '#ef4444' }}>
        {diff >= 0 ? '+' : ''}{diff.toFixed(2)} pts ({((diff / 100) * 100).toFixed(2)}%)
      </div>
    </div>
  );
};

export default function IndexChart({ history, currentValue }: Props) {
  const color = currentValue >= 100 ? '#22c55e' : '#ef4444';
  const gradientId = 'indexGrad';

  const data = history.map((h) => ({ ...h, time: fmt(h.time) }));

  return (
    <div style={{
      background: '#151820',
      border: '1px solid #262c3d',
      borderRadius: 12,
      padding: '20px 8px 12px 8px',
    }}>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2230" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fill: '#64748b', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            axisLine={false}
            tickLine={false}
            width={60}
            tickFormatter={(v) => v.toFixed(1)}
          />
          <ReferenceLine y={100} stroke="#3b82f6" strokeDasharray="4 4" strokeOpacity={0.6} />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
