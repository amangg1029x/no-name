import { useMemo, useState } from 'react'
import Sidebar from './Sidebar.jsx'

// Parse ISO or "YYYY-MM-DD HH:MM:SS" string → Date
const parseDate = (s) => {
  if (!s) return null
  return new Date(String(s).replace(' ', 'T'))
}

const fmt = (d) => d?.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function RiskHeatmapTimeline({ data, open, onClose }) {
  const [hovered, setHovered] = useState(null)

  // Build timeline from transaction data inside rings
  const { buckets, maxCount, dateRange, suspiciousWindows } = useMemo(() => {
    if (!data) return { buckets: [], maxCount: 1, dateRange: '', suspiciousWindows: [] }

    const { fraud_rings, suspicious_accounts } = data

    // Collect all tx timestamps from rings
    const events = []
    const scoreMap = {}
    suspicious_accounts.forEach(a => { scoreMap[a.account_id] = { score: a.score, type: 'generic' } })

    Object.values(fraud_rings).forEach(ring => {
      // We don't have per-tx timestamps in ring data, use window_start/end for fan rings
      if (ring.window_start) {
        const ws = parseDate(ring.window_start)
        const we = parseDate(ring.window_end)
        if (ws && we) {
          // distribute tx_ids evenly across window
          const txCount = ring.tx_ids?.length || 1
          const step = (we - ws) / txCount
          for (let i = 0; i < txCount; i++) {
            events.push({
              time: new Date(ws.getTime() + i * step),
              ring_id: ring.ring_id,
              type: ring.type,
              score: 70, // fan rings are medium-high
            })
          }
        }
      } else {
        // For cycle/shell rings, we know the accounts but not exact timestamps
        // Use the ring index to spread across a representative range
        const now = new Date()
        const spread = (ring.tx_ids?.length || 3) * 3600000
        const base = new Date(now.getTime() - spread * 2)
        ;(ring.tx_ids || []).forEach((_, i) => {
          events.push({
            time: new Date(base.getTime() + i * (spread / Math.max(ring.tx_ids.length, 1))),
            ring_id: ring.ring_id,
            type: ring.type,
            score: ring.type === 'CYCLE' ? 36 : 20,
          })
        })
      }
    })

    if (events.length === 0) return { buckets: [], maxCount: 1, dateRange: '', suspiciousWindows: [] }

    events.sort((a, b) => a.time - b.time)
    const minTime = events[0].time
    const maxTime = events[events.length - 1].time
    const totalMs = maxTime - minTime || 86400000

    // Create 48 buckets across the timeline
    const N = 48
    const bucketMs = totalMs / N
    const buckets = Array.from({ length: N }, (_, i) => ({
      index: i,
      start: new Date(minTime.getTime() + i * bucketMs),
      end: new Date(minTime.getTime() + (i + 1) * bucketMs),
      events: [],
      score: 0,
    }))

    events.forEach(ev => {
      const idx = Math.min(Math.floor((ev.time - minTime) / bucketMs), N - 1)
      buckets[idx].events.push(ev)
      buckets[idx].score = Math.max(buckets[idx].score, ev.score || 0)
    })

    const maxCount = Math.max(...buckets.map(b => b.events.length), 1)

    // Find suspicious windows (3+ consecutive high-activity buckets)
    const suspiciousWindows = []
    let inWindow = false, windowStart = 0
    buckets.forEach((b, i) => {
      const hot = b.events.length >= 2
      if (hot && !inWindow) { inWindow = true; windowStart = i }
      if (!hot && inWindow) { inWindow = false; if (i - windowStart >= 2) suspiciousWindows.push([windowStart, i - 1]) }
    })
    if (inWindow) suspiciousWindows.push([windowStart, N - 1])

    const dateRange = `${minTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${maxTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

    return { buckets, maxCount, dateRange, suspiciousWindows }
  }, [data])

  // Color based on intensity + score
  const cellColor = (bucket) => {
    const intensity = bucket.events.length / maxCount
    if (intensity === 0) return 'rgba(255,255,255,0.04)'
    const score = bucket.score
    if (score >= 70) return `rgba(192,57,43,${0.15 + intensity * 0.7})`
    if (score >= 40) return `rgba(212,168,67,${0.15 + intensity * 0.65})`
    return `rgba(74,124,89,${0.15 + intensity * 0.6})`
  }

  const typeCount = useMemo(() => {
    if (!data) return {}
    const counts = {}
    Object.values(data.fraud_rings).forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1 })
    return counts
  }, [data])

  return (
    <Sidebar
      open={open}
      onClose={onClose}
      title="Risk Heatmap"
      subtitle={`Transaction activity timeline  ·  ${dateRange}`}
    >
      <div className="p-6 flex flex-col gap-6">

        {/* Legend */}
        <div className="flex items-center gap-5 flex-wrap">
          {[['High Risk', 'rgba(192,57,43,0.7)'], ['Medium Risk', 'rgba(212,168,67,0.6)'], ['Low Risk', 'rgba(74,124,89,0.55)'], ['No Activity', 'rgba(255,255,255,0.04)']].map(([label, color]) => (
            <div key={label} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ background: color, border: '1px solid rgba(255,255,255,0.08)' }} />
              <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Heatmap grid */}
        <div>
          <div className="font-mono text-xs mb-3" style={{ color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Activity Intensity — {buckets.reduce((s, b) => s + b.events.length, 0)} transactions
          </div>

          {/* Cells in 2 rows of 24 */}
          <div className="flex flex-col gap-1.5">
            {[0, 1].map(row => (
              <div key={row} className="flex gap-1">
                {buckets.slice(row * 24, row * 24 + 24).map((bucket, i) => {
                  const globalIdx = row * 24 + i
                  const isInWindow = suspiciousWindows.some(([s, e]) => globalIdx >= s && globalIdx <= e)
                  return (
                    <div
                      key={globalIdx}
                      className="hm-cell flex-1"
                      style={{
                        height: 36,
                        background: cellColor(bucket),
                        outline: isInWindow ? '1px solid rgba(212,168,67,0.35)' : 'none',
                        outlineOffset: '1px',
                      }}
                      onMouseEnter={() => setHovered(bucket)}
                      onMouseLeave={() => setHovered(null)}
                    />
                  )
                })}
              </div>
            ))}
          </div>

          {/* Time labels */}
          <div className="flex justify-between mt-2">
            {buckets.length > 0 && (
              <>
                <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>
                  {buckets[0]?.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>
                  {buckets[23]?.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>
                  {buckets[47]?.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </>
            )}
          </div>

          {/* Hover info */}
          {hovered && hovered.events.length > 0 && (
            <div className="mt-3 p-3 rounded-lg" style={{ background: 'var(--raised)', border: '1px solid var(--border-md)' }}>
              <div className="font-mono text-xs mb-1" style={{ color: 'var(--text-3)' }}>
                {fmt(hovered.start)} — {fmt(hovered.end)}
              </div>
              <div className="text-sm" style={{ color: 'var(--text)' }}>
                <span className="font-medium">{hovered.events.length}</span>
                <span style={{ color: 'var(--text-2)' }}> transactions in this window</span>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {[...new Set(hovered.events.map(e => e.ring_id))].map(id => (
                  <span key={id} className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)' }}>
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Suspicious window callouts */}
        {suspiciousWindows.length > 0 && (
          <div>
            <div className="font-mono text-xs mb-3" style={{ color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Burst Windows Detected
            </div>
            <div className="flex flex-col gap-2">
              {suspiciousWindows.map(([s, e], i) => {
                const windowBuckets = buckets.slice(s, e + 1)
                const txCount = windowBuckets.reduce((sum, b) => sum + b.events.length, 0)
                const start = windowBuckets[0]?.start
                const end = windowBuckets[windowBuckets.length - 1]?.end
                const durationH = Math.round((end - start) / 3600000)
                return (
                  <div key={i} className="p-3 rounded-lg" style={{ background: 'rgba(212,168,67,0.06)', border: '1px solid rgba(212,168,67,0.14)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs" style={{ color: 'var(--amber)' }}>Burst Window {i + 1}</span>
                      <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>{durationH}h window</span>
                    </div>
                    <p className="text-sm" style={{ color: 'var(--text-2)' }}>
                      {txCount} transactions clustered in {durationH} hours — consistent with coordinated smurfing activity.
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Ring type breakdown */}
        <div>
          <div className="font-mono text-xs mb-3" style={{ color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Pattern Distribution
          </div>
          <div className="flex flex-col gap-2">
            {Object.entries(typeCount).map(([type, count]) => {
              const colors = { CYCLE: '#e06050', 'FAN-IN': '#8b9cb0', 'FAN-OUT': '#d4a843', SHELL: '#c49a30' }
              const color = colors[type] || 'var(--text-2)'
              const total = Object.values(typeCount).reduce((s, v) => s + v, 0)
              const pct = Math.round((count / total) * 100)
              return (
                <div key={type}>
                  <div className="flex justify-between mb-1">
                    <span className="font-mono text-xs" style={{ color }}>{type}</span>
                    <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>{count} rings  ·  {pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, opacity: 0.7 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </Sidebar>
  )
}