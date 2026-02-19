import { useState } from 'react'

const PATTERN_COLORS = {
  CYCLE:    '#ff3366',
  'FAN-IN': '#00d4ff',
  'FAN-OUT':'#00ff88',
  SHELL:    '#bb88ff',
}

const PATTERN_ICONS = {
  CYCLE:    '⟳',
  'FAN-IN': '⇥',
  'FAN-OUT':'⇤',
  SHELL:    '◈',
}

const TYPE_ORDER = { CYCLE: 0, 'FAN-IN': 1, 'FAN-OUT': 2, SHELL: 3 }

export default function FraudRingTable({ rings }) {
  const [expanded, setExpanded] = useState({})

  const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  const rows = Object.values(rings).sort(
    (a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
  )

  if (!rows.length) {
    return (
      <p className="text-slate-500 font-mono text-sm py-6 text-center">
        No fraud rings detected.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Ring ID', 'Pattern Type', 'Member Count', 'Risk Score', 'Total Amount', 'Members'].map((h) => (
              <th
                key={h}
                className="text-left py-3 px-4 text-slate-500 font-mono text-xs uppercase tracking-widest whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((ring) => {
            const color = PATTERN_COLORS[ring.type] || '#64748b'
            const icon  = PATTERN_ICONS[ring.type]  || '?'
            const exp   = expanded[ring.ring_id]
            const memberCount = ring.accounts?.length ?? 0
            /* Risk score proxy: based on type */
            const riskScore = ring.type === 'CYCLE'
              ? 40 : ring.type === 'SHELL' ? 20 : 30

            return (
              <tr
                key={ring.ring_id}
                className="ring-row border-b border-border/40 cursor-pointer"
                onClick={() => toggle(ring.ring_id)}
              >
                {/* Ring ID */}
                <td className="py-3 px-4 font-mono text-cpurple text-xs whitespace-nowrap">
                  {ring.ring_id}
                </td>

                {/* Pattern type badge */}
                <td className="py-3 px-4">
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-xs font-bold whitespace-nowrap"
                    style={{
                      background: color + '1a',
                      color,
                      border: `1px solid ${color}44`,
                    }}
                  >
                    {icon} {ring.type}
                  </span>
                </td>

                {/* Member count */}
                <td className="py-3 px-4 font-display font-bold text-slate-100 text-base">
                  {memberCount}
                </td>

                {/* Risk score bar */}
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width:      `${Math.min(100, riskScore + memberCount * 5)}%`,
                          background: color,
                        }}
                      />
                    </div>
                    <span className="font-mono text-xs" style={{ color }}>
                      {Math.min(100, riskScore + memberCount * 5)}
                    </span>
                  </div>
                </td>

                {/* Total amount */}
                <td className="py-3 px-4 font-mono text-cgreen text-xs whitespace-nowrap">
                  ${Number(ring.total_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>

                {/* Members — expandable */}
                <td className="py-3 px-4">
                  <div className={`transition-all overflow-hidden ${exp ? 'max-h-48' : 'max-h-6'}`}>
                    <div className="flex flex-wrap gap-1">
                      {(ring.accounts || []).map((a) => (
                        <span
                          key={a}
                          className="text-xs font-mono px-2 py-0.5 rounded bg-cardhi border border-border text-slate-400"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                  {!exp && memberCount > 3 && (
                    <span className="text-cblue text-xs font-mono mt-0.5 block">
                      +{memberCount - 3} more ▾
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}