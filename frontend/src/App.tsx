import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Snapshot } from './types';
import AuthPanel from './components/AuthPanel';
import IndexChart from './components/IndexChart';
import PositionsTable from './components/PositionsTable';

const EMPTY_CANDLES = { '1m': [], '5m': [], '15m': [], '1h': [], '1D': [] };

export default function App() {
  const [auth, setAuth]               = useState(false);
  const [data, setData]               = useState<Snapshot | null>(null);
  const [error, setError]             = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [connected, setConnected]     = useState(false);
  const [resetting, setResetting]     = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // Check auth on load
  useEffect(() => {
    axios.get('/api/status').then(({ data }) => setAuth(data.authenticated));
  }, []);

  // Open SSE stream once authenticated
  useEffect(() => {
    if (!auth) return;

    function openStream() {
      if (esRef.current) esRef.current.close();

      const es = new EventSource('/api/stream');
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setError('');
      };

      es.onmessage = (e) => {
        try {
          const snap = JSON.parse(e.data) as Snapshot;
          setData(snap);
          setLastUpdated(new Date());
          setConnected(true);
          setError('');
        } catch {}
      };

      es.onerror = () => {
        setConnected(false);
        setError('Stream disconnected — reconnecting…');
        // Browser auto-reconnects EventSource; clear error once it does
      };
    }

    openStream();
    return () => { esRef.current?.close(); esRef.current = null; };
  }, [auth]);

  async function manualRefresh() {
    try {
      const { data: snap } = await axios.get<Snapshot>('/api/snapshot');
      setData(snap);
      setLastUpdated(new Date());
      setError('');
    } catch (e: any) {
      setError(e.response?.data?.error || 'Refresh failed');
    }
  }

  async function resetBase() {
    setResetting(true);
    try {
      await axios.post('/api/reset-base');
    } finally {
      setResetting(false);
    }
  }

  if (!auth) return <AuthPanel onAuthenticated={() => setAuth(true)} />;

  const idx      = data?.indexValue ?? 100;
  const diff     = idx - 100;
  const isUp     = diff >= 0;
  const totalPnl = data?.totalPnl ?? 0;

  return (
    <div style={{ minHeight: '100vh', background: '#0d0f14', paddingBottom: 48 }}>

      {/* Header */}
      <header style={{
        background: '#151820', borderBottom: '1px solid #262c3d',
        padding: '0 32px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', height: 60,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>
            <span style={{ color: '#6366f1' }}>My</span> Index
          </span>
          <span style={{
            fontSize: 11, fontWeight: 500, padding: '2px 8px',
            background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderRadius: 4,
          }}>F&O · NFO</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Live indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? '#22c55e' : '#ef4444',
              boxShadow: connected ? '0 0 0 2px rgba(34,197,94,0.3)' : 'none',
              animation: connected ? 'pulse 2s infinite' : 'none',
              display: 'inline-block',
            }} />
            <span style={{ fontSize: 12, color: connected ? '#22c55e' : '#ef4444' }}>
              {connected ? 'Live' : 'Disconnected'}
            </span>
            {lastUpdated && connected && (
              <span style={{ fontSize: 11, color: '#334155' }}>
                · {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>

          {data?.baseSetAt && (
            <span style={{ fontSize: 11, color: '#334155', borderLeft: '1px solid #1e2230', paddingLeft: 16 }}>
              Base since {new Date(data.baseSetAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}{' '}
              {new Date(data.baseSetAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button onClick={manualRefresh} style={iconBtn}>↻ Refresh</button>
          <button onClick={resetBase} disabled={resetting} style={{ ...iconBtn, color: '#f59e0b' }}>
            {resetting ? 'Resetting…' : '⟳ Reset Base'}
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1340, margin: '0 auto', padding: '28px 32px 0' }}>
        {error && (
          <div style={{
            marginBottom: 20, padding: '12px 16px',
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 10, color: '#ef4444', fontSize: 13,
          }}>{error}</div>
        )}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 22 }}>
          <StatCard label="Index Value" large
            value={idx.toFixed(2)}
            sub={`${isUp ? '+' : ''}${diff.toFixed(2)} pts`}
            color={isUp ? '#22c55e' : '#ef4444'}
          />
          <StatCard label="Total Return"
            value={`${isUp ? '+' : ''}${((diff / 100) * 100).toFixed(2)}%`}
            sub="vs. base (100)"
            color={isUp ? '#22c55e' : '#ef4444'}
          />
          <StatCard label="Total P&L"
            value={`${totalPnl >= 0 ? '+' : ''}₹${fmt(Math.abs(totalPnl))}`}
            sub={data ? `on ₹${fmt(data.baseExposure)} base` : ''}
            color={totalPnl >= 0 ? '#22c55e' : '#ef4444'}
          />
          <StatCard label="Total Exposure"
            value={data ? `₹${fmt(data.totalExposure)}` : '—'}
            sub="current open positions"
          />
          <StatCard label="Positions"
            value={data?.positions.length.toString() ?? '0'}
            sub="active F&O legs"
          />
        </div>

        {/* Chart */}
        <div style={{ marginBottom: 22 }}>
          <IndexChart
            candles={(data?.candles ?? EMPTY_CANDLES) as any}
            currentValue={idx}
          />
        </div>

        {/* Table */}
        <div>
          <SectionLabel>F&O Positions · Exposure Weights</SectionLabel>
          {data?.positions.length ? (
            <PositionsTable positions={data.positions} />
          ) : (
            <EmptyState />
          )}
        </div>
      </main>
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, large }: {
  label: string; value: string; sub?: string; color?: string; large?: boolean;
}) {
  return (
    <div style={{ background: '#151820', border: '1px solid #262c3d', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 11, color: '#475569', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: large ? 26 : 18, fontWeight: 700,
        color: color ?? '#e2e8f0', lineHeight: 1,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: color ?? '#475569', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      background: '#151820', border: '1px solid #262c3d', borderRadius: 12,
      padding: 48, textAlign: 'center', color: '#334155',
    }}>
      No open F&O positions found in your Kite account.
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: '#1e2230', border: '1px solid #262c3d', borderRadius: 8,
  padding: '6px 14px', color: '#94a3b8', fontSize: 13, cursor: 'pointer',
};

const fmt = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
