import { useState } from 'react'

const TYPE_META = {
  CYCLE:    { color: '#c07868', label: 'Cycle',    icon: '↺' },
  'FAN-IN': { color: '#8b9cb0', label: 'Fan-In',   icon: '⇢' },
  'FAN-OUT':{ color: '#d4a843', label: 'Fan-Out',  icon: '⇠' },
  SHELL:    { color: '#c49a30', label: 'Shell',    icon: '⬦' },
}

const TYPE_ORDER = { CYCLE: 0, 'FAN-IN': 1, 'FAN-OUT': 2, SHELL: 3 }

export default function FraudRingTable({ rings, onSelectRing, selectedRingId }) {
  const rows = Object.values(rings).sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9))

  if (!rows.length) {
    return <div className="font-mono text-xs text-center py-10" style={{ color: 'var(--text-3)' }}>No fraud rings detected</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {['Ring ID', 'Pattern', 'Accounts', 'Amount', 'Transactions', 'Action'].map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(ring => {
            const meta    = TYPE_META[ring.type] || { color: 'var(--text-2)', label: ring.type, icon: '?' }
            const isSelected = ring.ring_id === selectedRingId
            return (
              <tr
                key={ring.ring_id}
                className={isSelected ? 'selected' : ''}
                onClick={() => onSelectRing(ring)}
              >
                {/* Ring ID */}
                <td>
                  <span className="font-mono text-xs" style={{ color: 'var(--text-2)' }}>
                    {ring.ring_id}
                  </span>
                </td>

                {/* Pattern */}
                <td>
                  <div className="flex items-center gap-2">
                    <span style={{ color: meta.color, fontSize: 14 }}>{meta.icon}</span>
                    <span className="font-mono text-xs" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                </td>

                {/* Accounts */}
                <td>
                  <div className="flex items-center gap-2">
                    <span className="font-serif text-base" style={{ color: 'var(--text)' }}>
                      {ring.accounts?.length ?? '—'}
                    </span>
                    <div className="flex gap-1">
                      {(ring.accounts || []).slice(0, 3).map(a => (
                        <span key={a} className="font-mono text-xs px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-3)', fontSize: 10 }}>
                          {a}
                        </span>
                      ))}
                      {(ring.accounts || []).length > 3 && (
                        <span className="font-mono text-xs" style={{ color: 'var(--text-3)', fontSize: 10 }}>
                          +{ring.accounts.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                {/* Amount */}
                <td>
                  <span className="font-mono text-xs" style={{ color: 'var(--text-2)' }}>
                    ${Number(ring.total_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </td>

                {/* Transactions */}
                <td>
                  <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>
                    {ring.tx_ids?.length ?? '—'}
                  </span>
                </td>

                {/* Action */}
                <td onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => onSelectRing(ring)}
                    className="font-mono text-xs px-3 py-1.5 rounded transition-all"
                    style={{
                      background: isSelected ? 'rgba(212,168,67,0.12)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${isSelected ? 'rgba(212,168,67,0.3)' : 'var(--border)'}`,
                      color: isSelected ? 'var(--amber)' : 'var(--text-3)',
                    }}
                    onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border-md)' } }}
                    onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--border)' } }}
                  >
                    {isSelected ? 'Viewing' : 'Explain →'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}