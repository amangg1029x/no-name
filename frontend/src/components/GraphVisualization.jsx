import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'

const riskColor = (score) => {
  if (score == null) return '#44444e'
  if (score >= 70)   return '#c07060'
  if (score >= 40)   return '#b8860b'
  return '#4a7c59'
}

const riskLabel = (score) => {
  if (score == null) return 'SKIPPED'
  if (score >= 70)   return 'HIGH'
  if (score >= 40)   return 'MEDIUM'
  return 'LOW'
}

const EDGE_COLORS = {
  CYCLE:    '#8a4030',
  'FAN-IN': '#4a5e70',
  'FAN-OUT':'#7a6020',
  SHELL:    '#6a5820',
}

export default function GraphVisualization({ data }) {
  const containerRef = useRef(null)
  const cyRef        = useRef(null)
  const [tooltip, setTooltip] = useState(null)

  useEffect(() => {
    if (!data) return

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
        const score  = scoreMap[id]
        const isHigh = score != null && score >= 70
        const isMed  = score != null && score >= 40 && score < 70
        const color  = riskColor(score)
        return { data: { id, score, isHigh, isMed, patterns: patternMap[id] || {}, color } }
      }),
      ...edges.map((e, i) => ({
        data: { id: `e${i}`, source: e.source, target: e.target,
                ring_id: e.ring_id, type: e.type, color: EDGE_COLORS[e.type] || '#4a4a54' }
      })),
    ]

    const initCytoscape = () => {
      const el = containerRef.current
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return

      if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null }

      cyRef.current = cytoscape({
        container: el,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color':        'data(color)',
              'background-opacity':      0.85,
              'border-width':            1,
              'border-color':            'data(color)',
              'border-opacity':          0.5,
              'width':  (e) => e.data('isHigh') ? 44 : e.data('isMed') ? 34 : 26,
              'height': (e) => e.data('isHigh') ? 44 : e.data('isMed') ? 34 : 26,
              'label':                   'data(id)',
              'color':                   'rgba(232,232,234,0.75)',
              'font-size':               8.5,
              'font-family':             '"DM Mono", monospace',
              'text-valign':             'bottom',
              'text-margin-y':           5,
              'text-background-color':   '#0a0a0b',
              'text-background-opacity': 0.7,
              'text-background-padding': '2px',
              'shadow-blur':   (e) => e.data('isHigh') ? 18 : 6,
              'shadow-color':  'data(color)',
              'shadow-opacity': (e) => e.data('isHigh') ? 0.6 : 0.25,
              'shadow-offset-x': 0,
              'shadow-offset-y': 0,
            },
          },
          {
            selector: 'node:selected',
            style: { 'border-width': 2, 'border-opacity': 1, 'shadow-blur': 24, 'shadow-opacity': 0.8 }
          },
          {
            selector: 'edge',
            style: {
              'width': 1.5,
              'line-color':            'data(color)',
              'target-arrow-color':    'data(color)',
              'target-arrow-shape':    'triangle',
              'curve-style':           'bezier',
              'opacity':               0.5,
              'arrow-scale':           0.9,
            },
          },
          { selector: 'edge:selected', style: { opacity: 0.9, width: 2 } },
        ],
        layout: {
          name: 'cose',
          animate: true,
          animationDuration: 600,
          // Stronger repulsion keeps rings visually separated
          nodeRepulsion: 28000,
          // Shorter ideal edge length clusters ring members together
          idealEdgeLength: 70,
          edgeElasticity: 100,
          // Higher gravity pulls disconnected components toward center
          // preventing the flat horizontal sprawl
          gravity: 1.8,
          gravityRange: 3.8,
          numIter: 2500,
          initialTemp: 200,
          coolingFactor: 0.97,
          minTemp: 1.0,
          fit: true,
          padding: 40,
          // Randomize initial positions to avoid degenerate linear layouts
          randomize: true,
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

    initCytoscape()

    const ro = new ResizeObserver(() => {
      if (!cyRef.current) initCytoscape()
      else cyRef.current.resize()
    })
    if (containerRef.current) ro.observe(containerRef.current)

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
    return [p.has_cycle && 'Cycle', p.has_fan && 'Fan', p.has_shell && 'Shell', p.has_velocity && 'Velocity'].filter(Boolean)
  }

  const totalNodes = data ? Object.values(data.fraud_rings).reduce((s, r) => s + (r.accounts?.length || 0), 0) : 0

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 14, right: 14, zIndex: 10,
        background: 'rgba(17,17,19,0.92)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8, padding: '10px 13px',
        display: 'flex', flexDirection: 'column', gap: 7,
      }}>
        {[['High ≥70', '#c07060'],['Medium 40–70','#b8860b'],['Low <40','#4a7c59'],['Skipped','#44444e']].map(([label, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, opacity: 0.85 }} />
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, color: 'rgba(139,139,148,1)' }}>{label}</span>
          </div>
        ))}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '2px 0' }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 120 }}>
          {[['Cycle','#8a4030'],['Fan-In','#4a5e70'],['Fan-Out','#7a6020'],['Shell','#6a5820']].map(([type, color]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 14, height: 2, background: color, borderRadius: 1 }} />
              <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 9, color: '#55555f' }}>{type}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ position: 'absolute', top: 14, left: 14, zIndex: 10, display: 'flex', gap: 8 }}>
        {[
          { label: 'nodes', value: totalNodes },
          { label: 'rings', value: data ? Object.keys(data.fraud_rings).length : 0 },
        ].map(({ label, value }) => (
          <div key={label} style={{
            padding: '4px 10px', borderRadius: 6,
            background: 'rgba(17,17,19,0.88)', border: '1px solid rgba(255,255,255,0.07)',
            fontFamily: '"DM Mono", monospace', fontSize: 10, color: '#55555f',
            display: 'flex', gap: 6, alignItems: 'center',
          }}>
            {label} <span style={{ color: '#8b9cb0' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="cy-tooltip">
          <div style={{ fontFamily: '"DM Mono", monospace', fontWeight: 500, fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>
            {tooltip.data.id}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: 'var(--text-3)' }}>Score</span>
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 13, fontWeight: 500, color: riskColor(tooltip.data.score) }}>
              {tooltip.data.score?.toFixed(1) ?? '—'}
            </span>
            <span style={{
              fontFamily: '"DM Mono", monospace', fontSize: 10,
              padding: '1px 6px', borderRadius: 3,
              background: riskColor(tooltip.data.score) + '18',
              color: riskColor(tooltip.data.score),
              border: `1px solid ${riskColor(tooltip.data.score)}28`,
            }}>
              {riskLabel(tooltip.data.score)}
            </span>
          </div>
          {tooltip.data.patterns?.ring_id && (
            <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, color: 'var(--text-3)', marginBottom: 6 }}>
              {tooltip.data.patterns.ring_id}
            </div>
          )}
          {activePatterns(tooltip.data).length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {activePatterns(tooltip.data).map(p => (
                <span key={p} style={{
                  fontFamily: '"DM Mono", monospace', fontSize: 9.5,
                  padding: '2px 6px', borderRadius: 3,
                  background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}