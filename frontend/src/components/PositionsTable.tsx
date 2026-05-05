import { useState } from 'react';
import { Position } from '../types';

interface Props { positions: Position[] }

interface Group {
  underlying: string;
  legs: Position[];
  totalExposure: number;
  totalWeight: number;
  totalPnl: number;
}

const num = (v: number, dec = 2) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const TYPE_COLOR: Record<string, string> = {
  CE: '#22c55e', PE: '#ef4444', FUT: '#f59e0b', UNKNOWN: '#64748b',
};

function groupPositions(positions: Position[]): Group[] {
  const map = new Map<string, Position[]>();
  for (const p of positions) {
    const key = p.underlying;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }

  return Array.from(map.entries())
    .map(([underlying, legs]) => {
      const totalExposure = legs.reduce((s, l) => s + l.exposure, 0);
      const totalWeight = legs.reduce((s, l) => s + l.weight, 0);
      const totalPnl = legs.reduce((s, l) => s + l.pnl, 0);
      // Sort legs: FUT first, then CE, then PE, then by strike
      const legOrder = { FUT: 0, CE: 1, PE: 2, UNKNOWN: 3 };
      legs.sort((a, b) =>
        (legOrder[a.instrumentType] ?? 3) - (legOrder[b.instrumentType] ?? 3) ||
        (a.strike ?? 0) - (b.strike ?? 0)
      );
      return { underlying, legs, totalExposure, totalWeight, totalPnl };
    })
    .sort((a, b) => b.totalWeight - a.totalWeight);
}

const COLS = ['Instrument / Leg', 'Type', 'Side', 'Qty', 'Entry', 'LTP', 'Exposure (₹)', 'Weight %', 'P&L (₹)', 'P&L %'];

export default function PositionsTable({ positions }: Props) {
  const groups = groupPositions(positions);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div style={{ background: '#151820', border: '1px solid #262c3d', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #262c3d' }}>
              {COLS.map((h, i) => (
                <th key={h} style={{
                  padding: '11px 14px',
                  textAlign: i === 0 ? 'left' : i <= 2 ? 'center' : 'right',
                  color: '#475569', fontWeight: 500, fontSize: 11,
                  whiteSpace: 'nowrap', letterSpacing: '0.04em', textTransform: 'uppercase',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = !collapsed.has(g.underlying);
              const pnlColor = g.totalPnl >= 0 ? '#22c55e' : '#ef4444';
              return (
                <>
                  {/* ── Group header row ── */}
                  <tr
                    key={`grp-${g.underlying}`}
                    onClick={() => toggle(g.underlying)}
                    style={{
                      borderBottom: isOpen ? '1px solid #1e2230' : '1px solid #262c3d',
                      background: '#1a1f2e',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <td style={{ padding: '13px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 11, color: '#475569', transition: 'transform 0.15s',
                          display: 'inline-block',
                          transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                        }}>▶</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0' }}>
                          {g.underlying}
                        </span>
                        <span style={{ fontSize: 11, color: '#475569' }}>
                          {g.legs.length} leg{g.legs.length > 1 ? 's' : ''}
                        </span>
                      </div>
                    </td>
                    {/* Type / Side blanks */}
                    <td /><td />
                    {/* Qty blank */}
                    <td />
                    {/* Entry / LTP blanks */}
                    <td /><td />
                    {/* Total exposure */}
                    <td style={{ ...cellR, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                      ₹{num(g.totalExposure)}
                    </td>
                    {/* Total weight */}
                    <td style={{ padding: '13px 14px', textAlign: 'right' }}>
                      <WeightBar weight={g.totalWeight} />
                    </td>
                    {/* Total P&L */}
                    <td style={{ ...cellR, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: pnlColor }}>
                      {g.totalPnl >= 0 ? '+' : ''}₹{num(g.totalPnl)}
                    </td>
                    {/* P&L % on exposure */}
                    <td style={{ ...cellR, fontWeight: 600, color: pnlColor }}>
                      {g.totalExposure > 0
                        ? `${g.totalPnl >= 0 ? '+' : ''}${((g.totalPnl / g.totalExposure) * 100).toFixed(2)}%`
                        : '—'}
                    </td>
                  </tr>

                  {/* ── Leg rows ── */}
                  {isOpen && g.legs.map((p, i) => {
                    const typeColor = TYPE_COLOR[p.instrumentType] ?? '#64748b';
                    const legPnlColor = p.pnl >= 0 ? '#22c55e' : '#ef4444';
                    const ltpColor = p.lastPrice >= p.avgPrice ? '#22c55e' : '#ef4444';
                    const isLast = i === g.legs.length - 1;
                    return (
                      <tr
                        key={p.symbol}
                        style={{
                          borderBottom: isLast ? '2px solid #262c3d' : '1px solid #131720',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#161b27')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        {/* Leg label with tree connector */}
                        <td style={{ padding: '10px 14px', paddingLeft: 36 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: '#2d3748', fontSize: 13 }}>
                              {isLast ? '└' : '├'}
                            </span>
                            <div>
                              <span style={{ fontWeight: 500, fontSize: 13, color: '#cbd5e1' }}>
                                {p.instrumentType === 'FUT'
                                  ? `${p.expiry} Future`
                                  : `${p.expiry} ${num(p.strike ?? 0, 0)} ${p.instrumentType}`}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Type */}
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                            background: `${typeColor}18`, color: typeColor,
                          }}>{p.instrumentType}</span>
                        </td>

                        {/* Side */}
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                            background: p.side === 'LONG' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                            color: p.side === 'LONG' ? '#22c55e' : '#ef4444',
                          }}>{p.side}</span>
                        </td>

                        <td style={{ ...cellR, color: '#94a3b8' }}>{Math.abs(p.quantity)}</td>
                        <td style={{ ...cellR, fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8' }}>
                          ₹{num(p.avgPrice)}
                        </td>
                        <td style={{ ...cellR, fontFamily: 'JetBrains Mono, monospace', color: ltpColor }}>
                          ₹{num(p.lastPrice)}
                        </td>
                        <td style={{ ...cellR, fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8' }}>
                          ₹{num(p.exposure)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                          <WeightBar weight={p.weight} dim />
                        </td>
                        <td style={{ ...cellR, fontFamily: 'JetBrains Mono, monospace', color: legPnlColor }}>
                          {p.pnl >= 0 ? '+' : ''}₹{num(p.pnl)}
                        </td>
                        <td style={{ ...cellR, color: legPnlColor }}>
                          {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const cellR: React.CSSProperties = { padding: '11px 14px', textAlign: 'right' };

function WeightBar({ weight, dim }: { weight: number; dim?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
      <div style={{ width: 56, height: 4, background: '#1a1f2e', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(weight, 100)}%`, height: '100%',
          background: dim ? '#4f5680' : '#6366f1', borderRadius: 2,
        }} />
      </div>
      <span style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
        minWidth: 44, textAlign: 'right',
        color: dim ? '#475569' : '#94a3b8',
      }}>
        {weight.toFixed(1)}%
      </span>
    </div>
  );
}
