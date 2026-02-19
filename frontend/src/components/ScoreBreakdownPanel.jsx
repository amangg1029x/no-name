import { useState } from 'react'
import Sidebar from './Sidebar.jsx'

const SEGMENT_META = {
  cycle:    { label: 'Cycle',    color: '#c07868', description: 'Circular transaction pattern' },
  fan:      { label: 'Fan',      color: '#8b9cb0', description: 'Fan-in / fan-out aggregation' },
  shell:    { label: 'Shell',    color: '#c49a30', description: 'Shell chain layering' },
  velocity: { label: 'Velocity', color: '#6aad82', description: 'High-frequency burst activity' },
}

// Reconstruct individual component scores using the same formula as suspicion_scorer.py
function decomposeScore(account) {
  const segments = []

  if (account.has_cycle) {
    // base 30 + 3 per extra node beyond 3 (cap 45)
    // We don't have cycle_length in the API response per-account, estimate from reasons
    const reasonMatch = (account.reasons || '').match(/cycle/i)
    const cycleScore = reasonMatch ? 30 : 0  // conservative — base only
    if (cycleScore > 0) segments.push({ key: 'cycle', value: cycleScore, ...SEGMENT_META.cycle })
  }

  if (account.has_fan) {
    // parse counterparties from reasons: "FAN-IN pattern (N counterparties in 72h)"
    const m = (account.reasons || '').match(/(\d+)\s+counterparties/)
    const cp = m ? parseInt(m[1]) : 10
    const extra = Math.max(0, cp - 10)
    const base = Math.min(20 + extra * 1.0, 45)
    const fanScore = Math.round(base * 1.3 * 10) / 10
    segments.push({ key: 'fan', value: fanScore, ...SEGMENT_META.fan })
  }

  if (account.has_shell) {
    // parse length from reasons: "length N"
    const m = (account.reasons || '').match(/length\s+(\d+)/i)
    const len = m ? parseInt(m[1]) : 4
    const hops = Math.max(0, (len - 1) - 3)
    const shellScore = Math.min(15 + hops * 4, 35)
    segments.push({ key: 'shell', value: shellScore, ...SEGMENT_META.shell })
  }

  if (account.has_velocity) {
    // velocity_txns not always in response, default to base 5 + a few
    const velScore = account.velocity_txns
      ? Math.min(5 + Math.max(0, account.velocity_txns - 5), 15)
      : 8  // reasonable default
    segments.push({ key: 'velocity', value: velScore, ...SEGMENT_META.velocity })
  }

  const total = segments.reduce((s, seg) => s + seg.value, 0)
  return { segments, total }
}

function AccountScoreBar({ account, isSelected, onClick }) {
  const { segments, total } = decomposeScore(account)
  const displayScore = account.score ?? total
  const riskLabel = displayScore >= 70 ? 'HIGH' : displayScore >= 40 ? 'MED' : 'LOW'
  const riskClass = displayScore >= 70 ? 'badge-high' : displayScore >= 40 ? 'badge-medium' : 'badge-low'

  return (
    <div
      className="py-3 px-4 cursor-pointer transition-all rounded-lg"
      style={{
        background: isSelected ? 'rgba(212,168,67,0.06)' : 'transparent',
        border: `1px solid ${isSelected ? 'rgba(212,168,67,0.2)' : 'transparent'}`,
      }}
      onClick={onClick}
    >
      {/* Account header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-xs" style={{ color: 'var(--text)' }}>{account.account_id}</span>
          <span className={`badge ${riskClass}`}>{riskLabel}</span>
        </div>
        <span className="font-mono text-sm font-medium" style={{
          color: displayScore >= 70 ? '#e06050' : displayScore >= 40 ? '#d4a843' : '#6aad82'
        }}>
          {displayScore?.toFixed(1)}
        </span>
      </div>

      {/* Stacked bar */}
      <div className="h-5 rounded-md overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.05)' }}>
        {segments.map((seg, i) => {
          const pct = (seg.value / 100) * 100
          return (
            <div
              key={seg.key}
              title={`${seg.label}: +${seg.value.toFixed(1)} pts`}
              style={{
                width: `${pct}%`,
                background: seg.color,
                opacity: 0.8,
                borderRight: i < segments.length - 1 ? '1px solid rgba(0,0,0,0.3)' : 'none',
                transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
              }}
            />
          )
        })}
      </div>

      {/* Segment labels (shown when selected) */}
      {isSelected && (
        <div className="mt-3 flex flex-col gap-2">
          {segments.map(seg => (
            <div key={seg.key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: seg.color, opacity: 0.8 }} />
                <span className="font-mono text-xs" style={{ color: 'var(--text-2)' }}>{seg.label}</span>
                <span className="text-xs" style={{ color: 'var(--text-3)' }}>{seg.description}</span>
              </div>
              <span className="font-mono text-xs" style={{ color: seg.color }}>+{seg.value.toFixed(1)}</span>
            </div>
          ))}
          <div className="divider my-1" />
          <div className="flex justify-between">
            <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>Total (capped at 100)</span>
            <span className="font-mono text-xs font-medium" style={{ color: 'var(--text)' }}>{displayScore?.toFixed(1)}</span>
          </div>
          {account.ring_id && (
            <div className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>
              Ring: <span style={{ color: 'var(--text-2)' }}>{account.ring_id}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ScoreBreakdownPanel({ data, open, onClose }) {
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('all')

  if (!data) return null

  const accounts = (data.suspicious_accounts || []).filter(a => !a.skipped)
  const filtered = filter === 'all' ? accounts
    : filter === 'high'   ? accounts.filter(a => a.score >= 70)
    : filter === 'medium' ? accounts.filter(a => a.score >= 40 && a.score < 70)
    : accounts.filter(a => a.score < 40)

  const topAccount = accounts.reduce((best, a) => (!best || (a.score ?? 0) > (best.score ?? 0)) ? a : best, null)

  return (
    <Sidebar
      open={open}
      onClose={onClose}
      title="Score Breakdown"
      subtitle={`Pattern contribution analysis  ·  ${accounts.length} scored accounts`}
    >
      <div className="flex flex-col" style={{ height: '100%' }}>

        {/* Summary stats */}
        <div className="px-6 py-4 flex gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
          {[
            { label: 'High ≥70', count: accounts.filter(a => a.score >= 70).length, color: '#e06050' },
            { label: 'Med 40–70', count: accounts.filter(a => a.score >= 40 && a.score < 70).length, color: '#d4a843' },
            { label: 'Low <40',  count: accounts.filter(a => a.score < 40).length, color: '#6aad82' },
          ].map(({ label, count, color }) => (
            <div key={label} className="flex-1 text-center">
              <div className="font-mono text-xl font-medium" style={{ color }}>{count}</div>
              <div className="font-mono text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="px-6 py-3 flex flex-wrap gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
          {Object.values(SEGMENT_META).map(m => (
            <div key={m.key} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: m.color, opacity: 0.8 }} />
              <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>{m.label}</span>
            </div>
          ))}
          <span className="font-mono text-xs ml-auto" style={{ color: 'var(--text-3)' }}>click row to expand</span>
        </div>

        {/* Filter tabs */}
        <div className="px-6 py-2.5 flex gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
          {[['all','All'],['high','High'],['medium','Medium'],['low','Low']].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              className="px-3 py-1 rounded font-mono text-xs transition-all"
              style={{
                background: filter === val ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: filter === val ? 'var(--text)' : 'var(--text-3)',
                border: `1px solid ${filter === val ? 'var(--border-md)' : 'transparent'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Account list */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {filtered.length === 0 ? (
            <div className="text-center py-10 font-mono text-xs" style={{ color: 'var(--text-3)' }}>
              No accounts in this tier
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filtered.map(account => (
                <AccountScoreBar
                  key={account.account_id}
                  account={account}
                  isSelected={selected === account.account_id}
                  onClick={() => setSelected(selected === account.account_id ? null : account.account_id)}
                />
              ))}
            </div>
          )}
        </div>

      </div>
    </Sidebar>
  )
}