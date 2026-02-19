import { useState } from 'react'
import axios from 'axios'

import UploadSection       from './components/UploadSection.jsx'
import GraphVisualization  from './components/GraphVisualization.jsx'
import FraudRingTable      from './components/FraudRingTable.jsx'
import SummaryCard         from './components/SummaryCard.jsx'
import DownloadButton      from './components/DownloadButton.jsx'
import RingExplainerPanel  from './components/RingExplainerPanel.jsx'
import RiskHeatmapTimeline from './components/RiskHeatmapTimeline.jsx'
import ScoreBreakdownPanel from './components/ScoreBreakdownPanel.jsx'

const API_URL = 'http://localhost:8000/api/analyze'

const riskColor = (score) => {
  if (score == null) return 'var(--text-2)'
  if (score >= 70)   return '#e06050'
  if (score >= 40)   return '#d4a843'
  return '#6aad82'
}
const fmt = (n) => (n == null ? '—' : Number(n).toFixed(1))

// Compute network density from fraud ring data
function computeNetworkDensity(fraudRings) {
  const nodeSet = new Set()
  let edgeCount = 0
  Object.values(fraudRings).forEach(ring => {
    (ring.accounts || []).forEach(a => nodeSet.add(a))
    const n = ring.accounts?.length || 0
    if (ring.type === 'CYCLE') edgeCount += n
    else edgeCount += Math.max(0, n - 1)
  })
  const nodes = nodeSet.size
  if (nodes <= 1) return 0
  const maxEdges = nodes * (nodes - 1)
  return maxEdges > 0 ? Math.min(edgeCount / maxEdges, 1) : 0
}

function densityLabel(d) {
  if (d >= 0.5) return 'Very high — tightly interconnected network'
  if (d >= 0.3) return 'High — significant cross-ring connectivity'
  if (d >= 0.15) return 'Moderate — several isolated clusters'
  return 'Low — sparse, disconnected rings'
}

export default function App() {
  const [loading, setLoading]     = useState(false)
  const [data,    setData]        = useState(null)
  const [error,   setError]       = useState(null)
  const [elapsed, setElapsed]     = useState(null)
  const [tab,     setTab]         = useState('graph')

  // Sidebar state
  const [ringPanel,    setRingPanel]    = useState({ open: false, ring: null })
  const [heatmapOpen,  setHeatmapOpen]  = useState(false)
  const [scoreOpen,    setScoreOpen]    = useState(false)

  const handleUpload = async (file) => {
    setLoading(true); setError(null); setData(null)
    const t0 = performance.now()
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await axios.post(API_URL, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setData(res.data)
      setElapsed(((performance.now() - t0) / 1000).toFixed(2))
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Connection failed — is the server running on port 8000?')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => { setData(null); setElapsed(null); setError(null) }

  const s  = data?.summary || {}
  const sd = s.score_distribution || {}
  const density = data ? computeNetworkDensity(data.fraud_rings) : null

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', position: 'relative', zIndex: 1 }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(10,10,11,0.92)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 28px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#c0392b' }} />
          </div>
          <div>
            <div className="font-serif" style={{ fontSize: 17, color: 'var(--text)', letterSpacing: '-0.01em', lineHeight: 1 }}>
              MuleTrace
            </div>
            <div className="font-mono" style={{ fontSize: 9.5, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 1 }}>
              AML Detection
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {data && (
            <>
              {/* Sidebar trigger buttons */}
              {[
                { label: '≋ Heatmap', action: () => setHeatmapOpen(true) },
                { label: '◫ Score Analysis', action: () => setScoreOpen(true) },
              ].map(({ label, action }) => (
                <button
                  key={label}
                  onClick={action}
                  className="font-mono text-xs px-3 py-1.5 rounded-lg transition-all"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-md)'; e.currentTarget.style.color = 'var(--text)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
                >
                  {label}
                </button>
              ))}

              <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

              <button
                onClick={reset}
                className="font-mono text-xs px-3 py-1.5 rounded-lg transition-all"
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border-md)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--border)' }}
              >
                ← New Upload
              </button>
            </>
          )}
          <DownloadButton data={data} disabled={loading} />

          {/* Status dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4a7c59' }} />
            <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>v1.0</span>
          </div>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: '28px', maxWidth: 1400, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Upload screen */}
        {!data && (
          <div className="fade-up">
            <div style={{ maxWidth: 580, margin: '60px auto 0' }}>
              <div style={{ textAlign: 'center', marginBottom: 32 }}>
                <h1 className="font-serif" style={{ fontSize: 32, color: 'var(--text)', marginBottom: 8, letterSpacing: '-0.02em' }}>
                  Financial Crime Detection
                </h1>
                <p className="font-mono" style={{ fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.04em' }}>
                  Upload a transaction CSV to detect money muling, shell networks, and circular layering
                </p>
              </div>
              <UploadSection onUpload={handleUpload} loading={loading} />
              {error && (
                <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 8, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.2)' }}>
                  <div className="font-mono text-xs" style={{ color: '#e06050' }}>⚠ {error}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Results */}
        {data && (
          <>
            {/* ── Stat cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              <SummaryCard
                label="Total Accounts"
                value={s.total_accounts}
                sub={`${s.total_transactions} transactions`}
                color="#8b9cb0" icon="○" delay="d1"
              />
              <SummaryCard
                label="Flagged Accounts"
                value={s.suspicious_accounts}
                sub={`${s.skipped_accounts || 0} skipped`}
                color="#c0392b" icon="◎" delay="d2"
              />
              <SummaryCard
                label="Fraud Rings"
                value={s.fraud_rings_detected}
                sub={Object.entries(s.rings_by_type || {}).map(([k,v]) => `${v} ${k}`).join('  ·  ')}
                color="#d4a843" icon="◈" delay="d3"
              />
              <SummaryCard
                label="Processing Time"
                value={elapsed ? `${elapsed}s` : '—'}
                sub={s.analysed_at ? new Date(s.analysed_at).toLocaleTimeString() : ''}
                color="#4a7c59" icon="◷" delay="d4"
              />
            </div>

            {/* ── Risk + Density bar ── */}
            <div className="card fade-up" style={{ padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
              {/* Risk distribution */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  Risk Distribution
                </span>
                {[
                  { label: 'High ≥70',  count: sd.high_risk_count,   color: '#e06050' },
                  { label: 'Med 40–70', count: sd.medium_risk_count, color: '#d4a843' },
                  { label: 'Low <40',   count: sd.low_risk_count,    color: '#6aad82' },
                ].map(({ label, count, color }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                    <span className="font-serif" style={{ fontSize: 20, color }}>{count ?? 0}</span>
                    <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</span>
                  </div>
                ))}
              </div>

              {/* Divider */}
              <div style={{ width: 1, height: 32, background: 'var(--border)', flexShrink: 0 }} />

              {/* Avg score */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase' }}>Avg Score</span>
                <span className="font-serif" style={{ fontSize: 24, color: riskColor(sd.mean) }}>{fmt(sd.mean)}</span>
              </div>

              {/* Divider */}
              <div style={{ width: 1, height: 32, background: 'var(--border)', flexShrink: 0 }} />

              {/* Network density */}
              {density !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                  <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    Network Density
                  </span>
                  <span className="font-serif" style={{ fontSize: 24, color: density >= 0.3 ? '#e06050' : density >= 0.15 ? '#d4a843' : '#6aad82' }}>
                    {density.toFixed(2)}
                  </span>
                  <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {densityLabel(density)}
                  </span>
                </div>
              )}

              {/* Score breakdown trigger */}
              <button
                onClick={() => setScoreOpen(true)}
                className="font-mono text-xs px-3 py-1.5 rounded-lg transition-all ml-auto"
                style={{ background: 'rgba(212,168,67,0.08)', border: '1px solid rgba(212,168,67,0.2)', color: 'var(--amber)', whiteSpace: 'nowrap' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,168,67,0.14)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(212,168,67,0.08)'}
              >
                Score Breakdown →
              </button>
            </div>

            {/* ── Tabs ── */}
            <div style={{ display: 'flex', gap: 4, padding: '4px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, width: 'fit-content' }}>
              {[['graph','Graph'], ['table','Ring Table'], ['accounts','Accounts']].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className="font-mono text-xs px-5 py-2 rounded-lg transition-all"
                  style={{
                    background: tab === id ? 'var(--raised)' : 'transparent',
                    border: `1px solid ${tab === id ? 'var(--border-md)' : 'transparent'}`,
                    color: tab === id ? 'var(--text)' : 'var(--text-3)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ── Graph view ── */}
            <div
              className="card"
              style={{
                height: 560,
                display: tab === 'graph' ? 'flex' : 'none',
                flexDirection: 'column',
              }}
            >
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                  Transaction Network Graph
                </span>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
                    hover node · scroll to zoom · drag to pan
                  </span>
                  <button
                    onClick={() => setHeatmapOpen(true)}
                    className="font-mono text-xs px-3 py-1 rounded transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text-3)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border-md)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                  >
                    ≋ Timeline
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                <GraphVisualization data={data} />
              </div>
            </div>

            {/* ── Ring table ── */}
            {tab === 'table' && (
              <div className="card fade-up">
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                    Fraud Ring Summary
                  </span>
                  <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
                    {Object.keys(data.fraud_rings).length} rings detected  ·  click row to explain
                  </span>
                </div>
                <FraudRingTable
                  rings={data.fraud_rings}
                  onSelectRing={(ring) => setRingPanel({ open: true, ring })}
                  selectedRingId={ringPanel.ring?.ring_id}
                />
              </div>
            )}

            {/* ── Accounts table ── */}
            {tab === 'accounts' && (
              <div className="card fade-up">
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                    Suspicious Accounts
                  </span>
                  <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
                    {data.suspicious_accounts.length} accounts
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        {['Account', 'Ring', 'Score', 'Risk', 'Patterns', 'Txns'].map(h => <th key={h}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.suspicious_accounts.map(a => {
                        const sc = a.score
                        const color = riskColor(sc)
                        const riskLabel = sc >= 70 ? 'HIGH' : sc >= 40 ? 'MED' : sc != null ? 'LOW' : 'SKIP'
                        const riskClass = sc >= 70 ? 'badge-high' : sc >= 40 ? 'badge-medium' : sc != null ? 'badge-low' : 'badge-skip'
                        return (
                          <tr key={a.account_id}>
                            <td><span className="font-mono text-xs" style={{ color: 'var(--text)' }}>{a.account_id}</span></td>
                            <td><span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>{a.ring_id}</span></td>
                            <td><span className="font-mono text-sm" style={{ color }}>{sc != null ? sc.toFixed(1) : '—'}</span></td>
                            <td><span className={`badge ${riskClass}`}>{riskLabel}</span></td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {a.has_cycle    && <span className="badge badge-cycle">CYC</span>}
                                {a.has_fan      && <span className="badge badge-fan">FAN</span>}
                                {a.has_shell    && <span className="badge badge-shell">SHL</span>}
                                {a.has_velocity && <span className="badge badge-vel">VEL</span>}
                              </div>
                            </td>
                            <td><span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>{a.total_txns}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer style={{ padding: '12px 28px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>MuleTrace · Financial Crime Analytics</span>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>API → {API_URL}</span>
      </footer>

      {/* ── Sidebars ────────────────────────────────────────────── */}
      <RingExplainerPanel
        ring={ringPanel.ring}
        open={ringPanel.open}
        onClose={() => setRingPanel(p => ({ ...p, open: false }))}
      />

      <RiskHeatmapTimeline
        data={data}
        open={heatmapOpen}
        onClose={() => setHeatmapOpen(false)}
      />

      <ScoreBreakdownPanel
        data={data}
        open={scoreOpen}
        onClose={() => setScoreOpen(false)}
      />
    </div>
  )
}