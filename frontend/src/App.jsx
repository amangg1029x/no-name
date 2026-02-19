import { useState } from 'react'
import axios from 'axios'

import UploadSection      from './components/UploadSection.jsx'
import GraphVisualization from './components/GraphVisualization.jsx'
import FraudRingTable     from './components/FraudRingTable.jsx'
import SummaryCard        from './components/SummaryCard.jsx'
import DownloadButton     from './components/DownloadButton.jsx'

const API_URL = 'http://localhost:8000/api/analyze'

const riskColor = (score) => {
  if (score == null) return '#64748b'
  if (score >= 70)   return '#ff3366'
  if (score >= 40)   return '#ffaa00'
  return '#00d4ff'
}

const fmt = (n) => (n == null ? '—' : Number(n).toFixed(1))

export default function App() {
  const [loading, setLoading]   = useState(false)
  const [data,    setData]      = useState(null)
  const [error,   setError]     = useState(null)
  const [elapsed, setElapsed]   = useState(null)
  const [tab,     setTab]       = useState('graph')

  /* ── Upload handler ── */
  const handleUpload = async (file) => {
    setLoading(true)
    setError(null)
    setData(null)
    const t0 = performance.now()

    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await axios.post(API_URL, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setData(res.data)
      setElapsed(((performance.now() - t0) / 1000).toFixed(2))
    } catch (e) {
      setError(
        e.response?.data?.detail ||
        e.message ||
        'Connection failed — is the FastAPI server running on port 8000?'
      )
    } finally {
      setLoading(false)
    }
  }

  const reset = () => { setData(null); setElapsed(null); setError(null) }

  const s  = data?.summary || {}
  const sd = s.score_distribution || {}

  return (
    <div className="grid-bg min-h-screen flex flex-col relative z-10">

      {/* ══ Header ══════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/70 backdrop-blur px-6 py-3 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8 text-cred pulse-dot">
            <div className="w-8 h-8 rounded-full bg-cred/15 border-2 border-cred flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-cred" />
            </div>
          </div>
          <div>
            <h1 className="font-display font-extrabold text-xl tracking-wider text-glow-blue text-cblue">
              MULETRACE
            </h1>
            <p className="text-slate-600 font-mono text-xs tracking-widest">
              FRAUD DETECTION SYSTEM
            </p>
          </div>
        </div>

        {/* Header actions */}
        <div className="flex items-center gap-4">
          {data && (
            <button
              onClick={reset}
              className="px-3 py-1.5 rounded-lg border border-border text-slate-500 font-mono text-xs hover:border-cblue/40 hover:text-cblue transition-all"
            >
              ← New Upload
            </button>
          )}
          <DownloadButton data={data} disabled={loading} />
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full bg-cgreen"
              style={{ boxShadow: '0 0 8px #00ff88' }}
            />
            <span className="font-mono text-xs text-slate-600">v1.0.0</span>
          </div>
        </div>
      </header>

      {/* ══ Main ════════════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col gap-6 p-6 w-full max-w-screen-2xl mx-auto">

        {/* ── Upload (shown until data loaded) ── */}
        {!data && (
          <section className="fade-in">
            <UploadSection onUpload={handleUpload} loading={loading} />

            {error && (
              <div className="mt-4 p-4 rounded-xl border border-cred/30 bg-cred/8 flex items-start gap-3">
                <span className="text-cred text-lg">⚠</span>
                <div>
                  <p className="text-cred font-ui font-semibold text-sm mb-0.5">Analysis Failed</p>
                  <p className="text-cred/70 font-mono text-xs">{error}</p>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Results ── */}
        {data && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                label="Total Accounts"
                value={s.total_accounts ?? '—'}
                sub={`${s.total_transactions ?? 0} transactions`}
                icon="◎"
                color="#00d4ff"
                delay="delay-100"
              />
              <SummaryCard
                label="Flagged Accounts"
                value={s.suspicious_accounts ?? '—'}
                sub={`${s.skipped_accounts ?? 0} skipped`}
                icon="⚠"
                color="#ff3366"
                delay="delay-200"
              />
              <SummaryCard
                label="Fraud Rings"
                value={s.fraud_rings_detected ?? '—'}
                sub={Object.entries(s.rings_by_type || {}).map(([k, v]) => `${v} ${k}`).join(' · ')}
                icon="⟳"
                color="#bb88ff"
                delay="delay-300"
              />
              <SummaryCard
                label="Processing Time"
                value={elapsed ? `${elapsed}s` : '—'}
                sub={s.analysed_at ? new Date(s.analysed_at).toLocaleTimeString() : ''}
                icon="⚡"
                color="#00ff88"
                delay="delay-400"
              />
            </div>

            {/* Score distribution bar */}
            {sd && (
              <div className="fade-in delay-100 rounded-xl border border-border bg-card px-5 py-3 flex items-center gap-6 flex-wrap">
                <span className="font-mono text-xs text-slate-500 uppercase tracking-widest shrink-0">
                  Risk Distribution
                </span>
                {[
                  { label: 'High ≥70',   count: sd.high_risk_count,   color: '#ff3366' },
                  { label: 'Medium 40–70', count: sd.medium_risk_count, color: '#ffaa00' },
                  { label: 'Low  <40',   count: sd.low_risk_count,    color: '#00d4ff' },
                ].map(({ label, count, color }) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                    <span className="font-display font-bold text-base" style={{ color }}>{count ?? 0}</span>
                    <span className="text-slate-500 font-mono text-xs">{label}</span>
                  </div>
                ))}
                <div className="ml-auto flex items-center gap-3">
                  <span className="text-slate-500 font-mono text-xs">AVG SCORE</span>
                  <span
                    className="font-display font-extrabold text-xl"
                    style={{ color: riskColor(sd.mean), textShadow: `0 0 12px ${riskColor(sd.mean)}50` }}
                  >
                    {fmt(sd.mean)}
                  </span>
                </div>
              </div>
            )}

            {/* Tab selector */}
            <div className="flex gap-1 bg-card rounded-xl border border-border p-1 w-fit">
              {[['graph', '⬡  Graph View'], ['table', '≡  Ring Table'], ['accounts', '⊞  Accounts']].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`px-5 py-2 rounded-lg font-ui font-semibold text-sm transition-all ${
                    tab === id
                      ? 'bg-cblue/12 text-cblue border border-cblue/25 text-glow-blue'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ── Graph View ── */}
            {tab === 'graph' && (
              <div
                className="fade-in rounded-xl border border-border bg-card overflow-hidden"
                style={{ height: '540px' }}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="font-mono text-xs text-slate-500 uppercase tracking-widest">
                    Transaction Network Graph
                  </span>
                  <span className="font-mono text-xs text-slate-600">
                    hover node for details · scroll to zoom · drag to pan
                  </span>
                </div>
                <div style={{ height: 'calc(100% - 44px)' }}>
                  <GraphVisualization data={data} />
                </div>
              </div>
            )}

            {/* ── Ring Table ── */}
            {tab === 'table' && (
              <div className="fade-in rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="font-mono text-xs text-slate-500 uppercase tracking-widest">
                    Fraud Ring Summary
                  </span>
                  <span className="font-mono text-xs text-slate-600">
                    {Object.keys(data.fraud_rings).length} rings · click row to expand members
                  </span>
                </div>
                <div className="p-4">
                  <FraudRingTable rings={data.fraud_rings} />
                </div>
              </div>
            )}

            {/* ── Accounts table ── */}
            {tab === 'accounts' && (
              <div className="fade-in rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="font-mono text-xs text-slate-500 uppercase tracking-widest">
                    Suspicious Accounts
                  </span>
                  <span className="font-mono text-xs text-slate-600">
                    {data.suspicious_accounts.length} accounts
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {['Account', 'Ring', 'Score', 'Risk', 'Flags', 'Txns', 'Reasons'].map((h) => (
                          <th
                            key={h}
                            className="text-left py-3 px-4 text-slate-500 font-mono text-xs uppercase tracking-widest"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.suspicious_accounts.map((a) => {
                        const color = riskColor(a.score)
                        return (
                          <tr key={a.account_id} className="ring-row border-b border-border/30">
                            <td className="py-2.5 px-4 font-mono font-bold text-slate-100 text-xs">
                              {a.account_id}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-cpurple text-xs">
                              {a.ring_id}
                            </td>
                            <td className="py-2.5 px-4">
                              <span className="font-mono font-bold text-sm" style={{ color }}>
                                {a.score != null ? fmt(a.score) : '—'}
                              </span>
                            </td>
                            <td className="py-2.5 px-4">
                              <span
                                className="text-xs px-2 py-0.5 rounded-full font-mono font-bold"
                                style={{
                                  background: color + '1a',
                                  color,
                                  border: `1px solid ${color}40`,
                                }}
                              >
                                {a.score >= 70 ? 'HIGH' : a.score >= 40 ? 'MEDIUM' : a.score != null ? 'LOW' : 'SKIP'}
                              </span>
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="flex gap-1 flex-wrap">
                                {a.has_cycle    && <span className="text-xs px-1.5 py-0.5 rounded bg-cred/10    text-cred    border border-cred/20    font-mono">CYC</span>}
                                {a.has_fan      && <span className="text-xs px-1.5 py-0.5 rounded bg-cblue/10   text-cblue   border border-cblue/20   font-mono">FAN</span>}
                                {a.has_shell    && <span className="text-xs px-1.5 py-0.5 rounded bg-cpurple/10 text-cpurple border border-cpurple/20 font-mono">SHL</span>}
                                {a.has_velocity && <span className="text-xs px-1.5 py-0.5 rounded bg-cgreen/10  text-cgreen  border border-cgreen/20  font-mono">VEL</span>}
                                {a.skipped      && <span className="text-xs px-1.5 py-0.5 rounded bg-camber/10  text-camber  border border-camber/20  font-mono">SKP</span>}
                              </div>
                            </td>
                            <td className="py-2.5 px-4 font-mono text-slate-500 text-xs">
                              {a.total_txns}
                            </td>
                            <td
                              className="py-2.5 px-4 font-mono text-slate-500 text-xs max-w-xs truncate"
                              title={a.reasons}
                            >
                              {a.reasons}
                            </td>
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

      {/* ══ Footer ══════════════════════════════════════════════════ */}
      <footer className="border-t border-border px-6 py-3 flex items-center justify-between">
        <span className="font-mono text-xs text-slate-700">
          MULETRACE · AML DETECTION ENGINE
        </span>
        <span className="font-mono text-xs text-slate-700">
          API → {API_URL}
        </span>
      </footer>
    </div>
  )
}