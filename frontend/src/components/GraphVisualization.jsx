import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'

const riskColor = (score) => {
  if (score == null) return '#64748b'
  if (score >= 70)   return '#ff3366'
  if (score >= 40)   return '#ffaa00'
  return '#00d4ff'
}

const riskLabel = (score) => {
  if (score == null) return 'SKIPPED'
  if (score >= 70)   return 'HIGH'
  if (score >= 40)   return 'MEDIUM'
  return 'LOW'
}

const fmt = (n) => (n == null ? '—' : Number(n).toFixed(1))

const EDGE_COLORS = {
  CYCLE:    '#ff3366',
  'FAN-IN': '#00d4ff',
  'FAN-OUT':'#00ff88',
  SHELL:    '#bb88ff',
}

export default function GraphVisualization({ data }) {
  const containerRef = useRef(null)
  const cyRef        = useRef(null)
  const [tooltip, setTooltip] = useState(null)

  useEffect(() => {
    if (!data) return

    // ── Build graph data ───────────────────────────────────────────
    const { suspicious_accounts, fraud_rings } = data

    const scoreMap   = {}
    const patternMap = {}
    suspicious_accounts.forEach((a) => {
      scoreMap[a.account_id]   = a.score
      patternMap[a.account_id] = {
        has_cycle: a.has_cycle, has_fan: a.has_fan,
        has_shell: a.has_shell, has_velocity: a.has_velocity,
        ring_id: a.ring_id, reasons: a.reasons, skipped: a.skipped,
      }
    })

    const nodeSet = new Set()
    const edges   = []

    Object.values(fraud_rings).forEach((ring) => {
      const accs = (ring.accounts || []).map(String)
      accs.forEach((a) => nodeSet.add(a))
      if (ring.type === 'CYCLE') {
        for (let i = 0; i < accs.length; i++) {
          edges.push({ source: accs[i], target: accs[(i + 1) % accs.length], ring_id: ring.ring_id, type: ring.type })
        }
      } else {
        for (let i = 0; i < accs.length - 1; i++) {
          edges.push({ source: accs[i], target: accs[i + 1], ring_id: ring.ring_id, type: ring.type })
        }
      }
    })

    const elements = [
      ...[...nodeSet].map((id) => {
        const score      = scoreMap[id]
        const suspicious = score != null && score >= 40
        const skipped    = patternMap[id]?.skipped
        const color      = skipped ? '#ffaa00' : suspicious ? '#ff3366' : '#00d4ff'
        return { data: { id, score, suspicious, skipped, patterns: patternMap[id] || {}, color } }
      }),
      ...edges.map((e, i) => ({
        data: { id: `e${i}`, source: e.source, target: e.target,
                ring_id: e.ring_id, type: e.type, color: EDGE_COLORS[e.type] || '#00d4ff' }
      })),
    ]

    // ── Init Cytoscape — wait for container to have real dimensions ─
    const initCytoscape = () => {
      const el = containerRef.current
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return

      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }

      cyRef.current = cytoscape({
        container: el,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color':        'data(color)',
              'border-width':            3,
              'border-color':            'data(color)',
              'border-opacity':          0.85,
              'width':  (e) => (e.data('suspicious') ? 46 : 30),
              'height': (e) => (e.data('suspicious') ? 46 : 30),
              'label':                   'data(id)',
              'color':                   '#e2e8f0',
              'font-size':               9,
              'font-family':             '"Share Tech Mono", monospace',
              'text-valign':             'bottom',
              'text-margin-y':           6,
              'text-background-color':   '#0f0f1a',
              'text-background-opacity': 0.85,
              'text-background-padding': '3px',
              'shadow-blur':   (e) => (e.data('suspicious') ? 28 : 8),
              'shadow-color':  'data(color)',
              'shadow-opacity':(e) => (e.data('suspicious') ? 0.95 : 0.4),
              'shadow-offset-x': 0,
              'shadow-offset-y': 0,
            },
          },
          { selector: 'node:selected', style: { 'border-width': 5, 'shadow-blur': 48, 'shadow-opacity': 1 } },
          {
            selector: 'edge',
            style: {
              'width': 2, 'line-color': 'data(color)',
              'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle',
              'curve-style': 'bezier', 'opacity': 0.65, 'arrow-scale': 1.2,
            },
          },
          { selector: 'edge:selected', style: { 'opacity': 1, 'width': 3 } },
        ],
        layout: {
          name: 'cose', animate: true, animationDuration: 900,
          nodeRepulsion: 14000, idealEdgeLength: 130, edgeElasticity: 100,
          gravity: 0.25, numIter: 1000, fit: true, padding: 40,
        },
        userZoomingEnabled:  true,
        userPanningEnabled:  true,
        boxSelectionEnabled: false,
        backgroundColor:     'transparent',
      })

      cyRef.current.on('mouseover', 'node', (e) => {
        const pos = e.originalEvent
        setTooltip({ x: pos.clientX, y: pos.clientY, data: e.target.data() })
      })
      cyRef.current.on('mouseout',  'node', () => setTooltip(null))
      cyRef.current.on('mousemove', 'node', (e) => {
        setTooltip((t) => t ? { ...t, x: e.originalEvent.clientX, y: e.originalEvent.clientY } : t)
      })
    }

    // Try immediately — works if container already has dimensions
    initCytoscape()

    // Fallback: ResizeObserver fires when the container gets real size
    // (handles the case where this component renders before layout paints)
    const ro = new ResizeObserver(() => {
      if (!cyRef.current) initCytoscape()
      else cyRef.current.resize()
    })
    if (containerRef.current) ro.observe(containerRef.current)

    // Belt-and-suspenders: retry after layout has fully painted
    const timer = setTimeout(() => {
      if (!cyRef.current) initCytoscape()
      else cyRef.current.resize()
    }, 200)

    return () => {
      ro.disconnect()
      clearTimeout(timer)
      if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null }
    }
  }, [data])

  const activePatterns = (d) => {
    const p = d.patterns || {}
    return [
      p.has_cycle    && 'Cycle',
      p.has_fan      && 'Fan-In/Out',
      p.has_shell    && 'Shell',
      p.has_velocity && 'Velocity',
    ].filter(Boolean)
  }

  const totalNodes = data
    ? Object.values(data.fraud_rings).reduce((s, r) => s + (r.accounts?.length || 0), 0)
    : 0

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Canvas — Cytoscape needs explicit pixel dimensions, position:absolute with inset:0 gives that */}
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {/* Legend — positioned relative to the outer wrapper div */}
      <div className="absolute top-3 right-3 flex flex-col gap-2 bg-card/90 backdrop-blur p-3 rounded-xl border border-border text-xs font-mono" style={{ zIndex: 10 }}>
        {[['High ≥70','#ff3366'],['Medium 40-70','#ffaa00'],['Low <40','#00d4ff'],['Skipped','#64748b']].map(([label, color]) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
            <span className="text-slate-500">{label}</span>
          </div>
        ))}
        <div className="border-t border-border mt-1 pt-1 text-slate-600">Scroll = zoom</div>
      </div>

      {/* Stats overlay */}
      <div className="absolute top-3 left-3 flex gap-3 text-xs font-mono text-slate-500" style={{ zIndex: 10 }}>
        <span className="bg-card/80 px-2 py-1 rounded-lg border border-border">
          nodes <span className="text-cblue ml-1">{totalNodes}</span>
        </span>
        <span className="bg-card/80 px-2 py-1 rounded-lg border border-border">
          rings <span className="text-cpurple ml-1">{data ? Object.keys(data.fraud_rings).length : 0}</span>
        </span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="cy-tooltip" style={{ left: tooltip.x, top: tooltip.y, zIndex: 9999 }}>
          <div className="font-display font-bold text-base text-slate-100 mb-2">{tooltip.data.id}</div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-slate-500 font-mono text-xs">SCORE</span>
            <span className="font-mono font-bold text-sm" style={{ color: riskColor(tooltip.data.score) }}>
              {fmt(tooltip.data.score)}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold"
              style={{ background: riskColor(tooltip.data.score)+'22', color: riskColor(tooltip.data.score), border:`1px solid ${riskColor(tooltip.data.score)}44` }}>
              {riskLabel(tooltip.data.score)}
            </span>
          </div>
          {tooltip.data.patterns?.ring_id && (
            <div className="text-slate-500 font-mono text-xs mb-1">
              Ring: <span className="text-cpurple">{tooltip.data.patterns.ring_id}</span>
            </div>
          )}
          {activePatterns(tooltip.data).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {activePatterns(tooltip.data).map((p) => (
                <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-cblue/10 text-cblue border border-cblue/20 font-mono">{p}</span>
              ))}
            </div>
          )}
          {tooltip.data.skipped && <div className="text-camber text-xs font-mono mt-2">⚠ Skipped (≥ 50 txns)</div>}
        </div>
      )}
    </div>
  )
}