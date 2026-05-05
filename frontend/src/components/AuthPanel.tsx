import { useState } from 'react';
import axios from 'axios';

interface Props {
  onAuthenticated: () => void;
}

export default function AuthPanel({ onAuthenticated }: Props) {
  const [requestToken, setRequestToken] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [mode, setMode] = useState<'oauth' | 'manual'>('oauth');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function openLogin() {
    const { data } = await axios.get('/api/login-url');
    window.open(data.url, '_blank');
  }

  async function submitRequestToken() {
    if (!requestToken.trim()) return;
    setLoading(true);
    setError('');
    try {
      await axios.post('/api/auth', { requestToken: requestToken.trim() });
      onAuthenticated();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function submitManualToken() {
    if (!manualToken.trim()) return;
    setLoading(true);
    setError('');
    try {
      await axios.post('/api/set-token', { token: manualToken.trim() });
      onAuthenticated();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to set token');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0d0f14',
    }}>
      <div style={{
        background: '#151820',
        border: '1px solid #262c3d',
        borderRadius: 16,
        padding: 40,
        width: 420,
      }}>
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>
            <span style={{ color: '#6366f1' }}>My</span> Index
          </div>
          <div style={{ color: '#64748b', fontSize: 13 }}>Connect your Zerodha Kite account to get started</div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['oauth', 'manual'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: mode === m ? '#6366f1' : '#1e2230', color: mode === m ? '#fff' : '#94a3b8',
              fontWeight: 500, fontSize: 13,
            }}>
              {m === 'oauth' ? 'OAuth Flow' : 'Manual Token'}
            </button>
          ))}
        </div>

        {mode === 'oauth' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={openLogin} style={btnStyle('#3b82f6')}>
              1. Login with Kite →
            </button>
            <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center' }}>
              After login, copy the <code style={{ color: '#e2e8f0' }}>request_token</code> from the redirect URL
            </div>
            <input
              value={requestToken}
              onChange={(e) => setRequestToken(e.target.value)}
              placeholder="Paste request_token here"
              style={inputStyle}
            />
            <button onClick={submitRequestToken} disabled={loading || !requestToken.trim()} style={btnStyle('#6366f1')}>
              {loading ? 'Authenticating…' : '2. Authenticate'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>
              Paste an existing <code style={{ color: '#e2e8f0' }}>access_token</code> (valid for today's session)
            </div>
            <input
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="Paste access_token here"
              style={inputStyle}
            />
            <button onClick={submitManualToken} disabled={loading || !manualToken.trim()} style={btnStyle('#6366f1')}>
              {loading ? 'Setting…' : 'Connect'}
            </button>
          </div>
        )}

        {error && (
          <div style={{
            marginTop: 16, padding: '10px 14px', background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', fontSize: 13,
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#1e2230', border: '1px solid #262c3d', borderRadius: 8,
  padding: '10px 14px', color: '#e2e8f0', fontSize: 13, width: '100%', outline: 'none',
  fontFamily: 'JetBrains Mono, monospace',
};

const btnStyle = (bg: string): React.CSSProperties => ({
  background: bg, border: 'none', borderRadius: 8, padding: '11px 0',
  color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', width: '100%',
  opacity: 1, transition: 'opacity 0.15s',
});
