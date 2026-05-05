import { Position } from '../types';

interface Props { positions: Position[] }

const num = (v: number, dec = 2) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const TYPE_COLOR: Record<string, string> = {
  CE: '#22c55e', PE: '#ef4444', FUT: '#f59e0b', UNKNOWN: '#64748b',
};

export default function PositionsTable({ positions }: Props) {
  const sorted = [...positions].sort((a, b) => b.weight - a.weight);

  return (
    <div style={{ background: '#151820', border: '1px solid #262c3d', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #262c3d' }}>
              {[
                { label: 'Instrument', align: 'left' },
                { label: 'Type', align: 'center' },
                { label: 'Side', align: 'center' },
                { label: 'Qty', align: 'right' },
                { label: 'Entry Price', align: 'right' },
                { label: 'LTP', align: 'right' },
                { label: 'Exposure (₹)', align: 'right' },
                { label: 'Weight %', align: 'right' },
                { label: 'P&L (₹)', align: 'right' },
                { label: 'P&L %', align: 'right' },
              ].map(({ label, align }) => (
                <th key={label} style={{
                  padding: '11px 14px', textAlign: align as any,
                  color: '#475569', fontWeight: 500, fontSize: 11,
                  whiteSpace: 'nowrap', letterSpacing: '0.04em', textTransform: 'uppercase',
                }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const typeColor = TYPE_COLOR[p.instrumentType] ?? '#64748b';
              const pnlColor = p.pnl >= 0 ? '#22c55e' : '#ef4444';
              const ltpColor = p.lastPrice >= p.avgPrice ? '#22c55e' : '#ef4444';
              return (
                <tr key={p.symbol}
                  style={{ borderBottom: '1px solid #1a1f2e', transition: 'background 0.1s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1f2e')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Instrument */}
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.underlying}</div>
                    <div style={{ fontSize: 11, color: '#475569', fontFamily: 'JetBrains Mono, monospace' }}>
                      {p.expiry}{p.strike ? ` ${num(p.strike, 0)}` : ''}
                    </div>
                  </td>

                  {/* Type badge */}
                  <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: `${typeColor}20`, color: typeColor,
                    }}>{p.instrumentType}</span>
                  </td>

                  {/* Side badge */}
                  <td style={{ padding: '11px 14px', textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                      background: p.side === 'LONG' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                      color: p.side === 'LONG' ? '#22c55e' : '#ef4444',
                    }}>{p.side}</span>
                  </td>

                  <td style={cellR}>{Math.abs(p.quantity)}</td>
                  <td style={{ ...cellR, fontFamily: 'JetBrains Mono, monospace' }}>₹{num(p.avgPrice)}</td>
                  <td style={{ ...cellR, fontFamily: 'JetBrains Mono, monospace', color: ltpColor }}>
                    ₹{num(p.lastPrice)}
                  </td>
                  <td style={{ ...cellR, fontFamily: 'JetBrains Mono, monospace' }}>₹{num(p.exposure)}</td>

                  {/* Weight bar */}
                  <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                    <WeightBar weight={p.weight} />
                  </td>

                  <td style={{ ...cellR, fontFamily: 'JetBrains Mono, monospace', color: pnlColor }}>
                    {p.pnl >= 0 ? '+' : ''}₹{num(p.pnl)}
                  </td>
                  <td style={{ ...cellR, color: pnlColor }}>
                    {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const cellR: React.CSSProperties = { padding: '11px 14px', textAlign: 'right' };

function WeightBar({ weight }: { weight: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
      <div style={{ width: 56, height: 4, background: '#1e2230', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(weight, 100)}%`, height: '100%', background: '#6366f1', borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, minWidth: 44, textAlign: 'right' }}>
        {weight.toFixed(1)}%
      </span>
    </div>
  );
}
