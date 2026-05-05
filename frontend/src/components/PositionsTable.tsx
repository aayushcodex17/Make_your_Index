import { Position } from '../types';

interface Props {
  positions: Position[];
}

const num = (v: number, dec = 2) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

export default function PositionsTable({ positions }: Props) {
  const sorted = [...positions].sort((a, b) => b.weight - a.weight);

  return (
    <div style={{
      background: '#151820',
      border: '1px solid #262c3d',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #262c3d' }}>
              {['Symbol', 'Qty', 'Avg Price', 'LTP', 'Exposure (₹)', 'Curr. Value (₹)', 'Weight %', 'P&L', 'P&L %'].map((h) => (
                <th key={h} style={{
                  padding: '12px 16px',
                  textAlign: h === 'Symbol' ? 'left' : 'right',
                  color: '#64748b',
                  fontWeight: 500,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.symbol} style={{ borderBottom: '1px solid #1a1f2e' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1f2e')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ fontWeight: 600 }}>{p.symbol}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{p.exchange}</div>
                </td>
                <td style={cell}>{p.quantity}</td>
                <td style={{ ...cell, fontFamily: 'JetBrains Mono, monospace' }}>₹{num(p.avgPrice)}</td>
                <td style={{ ...cell, fontFamily: 'JetBrains Mono, monospace', color: p.lastPrice >= p.avgPrice ? '#22c55e' : '#ef4444' }}>
                  ₹{num(p.lastPrice)}
                </td>
                <td style={{ ...cell, fontFamily: 'JetBrains Mono, monospace' }}>₹{num(p.exposure)}</td>
                <td style={{ ...cell, fontFamily: 'JetBrains Mono, monospace' }}>₹{num(p.currentValue)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <WeightBar weight={p.weight} />
                </td>
                <td style={{ ...cell, fontFamily: 'JetBrains Mono, monospace', color: p.pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                  {p.pnl >= 0 ? '+' : ''}₹{num(p.pnl)}
                </td>
                <td style={{ ...cell, color: p.pnlPct >= 0 ? '#22c55e' : '#ef4444' }}>
                  {pct(p.pnlPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const cell: React.CSSProperties = { padding: '12px 16px', textAlign: 'right' };

function WeightBar({ weight }: { weight: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
      <div style={{ width: 60, height: 4, background: '#262c3d', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${weight}%`, height: '100%', background: '#6366f1', borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, minWidth: 40, textAlign: 'right' }}>
        {weight.toFixed(1)}%
      </span>
    </div>
  );
}
