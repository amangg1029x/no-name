import Sidebar from './Sidebar.jsx'

const TYPE_META = {
  CYCLE:    { label: 'Circular Layering', color: '#e06050', icon: '↺' },
  'FAN-IN': { label: 'Aggregation Pattern', color: '#8b9cb0', icon: '⇢' },
  'FAN-OUT':{ label: 'Smurfing / Distribution', color: '#d4a843', icon: '⇠' },
  SHELL:    { label: 'Shell Chain Layering', color: '#c49a30', icon: '⬦' },
}

const PATTERN_DESCRIPTIONS = {
  CYCLE: (ring) => {
    const accs = ring.accounts || []
    const n    = accs.length
    const amt  = Number(ring.total_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
    return {
      summary: `${n} accounts form a closed loop, circulating $${amt} back to the origin. This is the hallmark of circular layering — funds move through a chain of intermediaries only to return to the starting account, obscuring the money trail.`,
      steps: [
        { label: 'Entry', text: `Funds originate at ${accs[0]}`, icon: '01' },
        ...accs.slice(1).map((a, i) => ({
          label: `Hop ${i + 2}`,
          text: `Transferred to ${a}`,
          icon: String(i + 2).padStart(2, '0')
        })),
        { label: 'Return', text: `Loop closes — funds return to ${accs[0]}`, icon: '⟳', highlight: true },
      ],
      risk_factors: [
        `Closed ${n}-node cycle detected — ${n >= 5 ? 'unusually complex' : 'textbook'} circular structure`,
        `$${amt} in aggregate value circulated`,
        ring.cycle_length >= 4 ? 'Multi-hop structure suggests deliberate obfuscation' : null,
      ].filter(Boolean),
      what_to_do: 'File a Suspicious Activity Report (SAR). Freeze the accounts pending investigation. Cross-reference with KYC records for beneficial ownership.',
    }
  },

  'FAN-IN': (ring) => {
    const acc = ring.accounts?.[0] || 'unknown'
    const cp  = ring.counterparty_count || '?'
    const amt = Number(ring.total_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
    return {
      summary: `${acc} received funds from ${cp} distinct sources within a 72-hour window, aggregating $${amt}. This pattern is consistent with smurfing — multiple actors breaking large amounts into smaller deposits to avoid detection thresholds.`,
      steps: [
        { label: 'Structuring', text: `${cp} source accounts each send sub-threshold amounts`, icon: '01' },
        { label: 'Aggregation', text: `All flows converge at ${acc}`, icon: '02', highlight: true },
        { label: 'Window', text: `Entire operation completed within 72 hours`, icon: '03' },
      ],
      risk_factors: [
        `${cp} unique counterparties — ${cp >= 15 ? 'extremely high' : cp >= 10 ? 'high'  : 'elevated'} concentration`,
        `$${amt} aggregated — possible structuring to avoid CTR thresholds`,
        'Burst pattern within 72h window suggests coordination',
      ],
      what_to_do: 'Investigate the ${cp} source accounts for common beneficial ownership. Check if individual amounts fall below $10,000 CTR threshold (classic structuring indicator).',
    }
  },

  'FAN-OUT': (ring) => {
    const acc = ring.accounts?.[0] || 'unknown'
    const cp  = ring.counterparty_count || '?'
    const amt = Number(ring.total_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
    return {
      summary: `${acc} dispersed $${amt} to ${cp} distinct accounts within a 72-hour window. Rapid outward distribution after aggregation is a classic money mule behavior — funds are broken up and moved quickly to complicate tracing.`,
      steps: [
        { label: 'Source', text: `${acc} holds aggregated funds`, icon: '01' },
        { label: 'Dispersion', text: `Rapid transfers out to ${cp} accounts`, icon: '02', highlight: true },
        { label: 'Layering', text: `Funds dispersed before tracing can occur`, icon: '03' },
      ],
      risk_factors: [
        `${cp} destination accounts — broad dispersal pattern`,
        `$${amt} distributed rapidly`,
        'Fan-out following likely aggregation is a two-stage laundering indicator',
      ],
      what_to_do: `Identify downstream recipients. Check if any destination accounts have prior SAR filings. Map beneficial ownership across the ${cp} recipients.`,
    }
  },

  SHELL: (ring) => {
    const accs = ring.accounts || []
    const hops = ring.hops || accs.length - 1
    const amt  = Number(ring.total_amount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
    return {
      summary: `$${amt} passed through ${accs.length} accounts across ${hops} hops in a linear chain. Each account in this chain shows minimal legitimate activity, consistent with shell accounts created solely to layer funds and increase tracing complexity.`,
      steps: accs.map((a, i) => ({
        label: i === 0 ? 'Entry' : i === accs.length - 1 ? 'Exit' : `Layer ${i}`,
        text: i === 0 ? `Funds enter at ${a}` : i === accs.length - 1 ? `Funds exit at ${a}` : `Passed through ${a} — low activity account`,
        icon: String(i + 1).padStart(2, '0'),
        highlight: i === accs.length - 1,
      })),
      risk_factors: [
        `${hops}-hop chain — ${hops >= 5 ? 'deep' : hops >= 4 ? 'significant' : 'moderate'} layering depth`,
        `Each intermediate account has minimal independent activity`,
        `$${amt} passed through with minimal transformation`,
      ],
      what_to_do: 'Determine the ultimate beneficial owner of the exit account. Each intermediary account should be investigated for shell company status.',
    }
  },
}

export default function RingExplainerPanel({ ring, open, onClose }) {
  if (!ring) return null

  const meta = TYPE_META[ring.type] || { label: ring.type, color: 'var(--text-2)', icon: '?' }
  const desc = (PATTERN_DESCRIPTIONS[ring.type] || PATTERN_DESCRIPTIONS['SHELL'])(ring)

  return (
    <Sidebar
      open={open}
      onClose={onClose}
      title={ring.ring_id}
      subtitle={`${meta.label}  ·  ${ring.accounts?.length || 0} accounts  ·  $${Number(ring.total_amount||0).toLocaleString(undefined,{maximumFractionDigits:0})}`}
    >
      <div className="p-6 flex flex-col gap-6">

        {/* Pattern badge + amount */}
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
            style={{ background: meta.color + '18', color: meta.color, border: `1px solid ${meta.color}28` }}
          >
            {meta.icon}
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>{meta.label}</div>
            <div className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>
              {ring.ring_id}  ·  {ring.tx_ids?.length || 0} transactions
            </div>
          </div>
        </div>

        {/* Summary paragraph */}
        <div
          className="p-4 rounded-lg text-sm leading-relaxed"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border)', color: 'var(--text-2)' }}
        >
          {desc.summary}
        </div>

        {/* Step-by-step flow */}
        <div>
          <div className="font-mono text-xs mb-3" style={{ color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Transaction Flow
          </div>
          <div className="relative">
            {/* Vertical line */}
            <div
              className="absolute left-[18px] top-5 bottom-5"
              style={{ width: '1px', background: 'var(--border)' }}
            />
            <div className="flex flex-col gap-0">
              {desc.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-4 py-2.5 relative">
                  {/* Step number dot */}
                  <div
                    className="w-9 h-6 rounded flex items-center justify-center flex-shrink-0 font-mono text-xs relative z-10"
                    style={{
                      background: step.highlight ? meta.color + '22' : 'var(--raised)',
                      border: `1px solid ${step.highlight ? meta.color + '44' : 'var(--border-md)'}`,
                      color: step.highlight ? meta.color : 'var(--text-3)',
                    }}
                  >
                    {step.icon}
                  </div>
                  <div className="flex-1 pt-0.5">
                    <div className="font-mono text-xs mb-0.5" style={{ color: step.highlight ? meta.color : 'var(--text-3)', letterSpacing: '0.06em' }}>
                      {step.label}
                    </div>
                    <div className="text-sm" style={{ color: step.highlight ? 'var(--text)' : 'var(--text-2)' }}>
                      {step.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Risk factors */}
        <div>
          <div className="font-mono text-xs mb-3" style={{ color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Risk Indicators
          </div>
          <div className="flex flex-col gap-2">
            {desc.risk_factors.map((f, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: meta.color }} />
                <div className="text-sm" style={{ color: 'var(--text-2)' }}>{f}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Account list */}
        <div>
          <div className="font-mono text-xs mb-3" style={{ color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Involved Accounts
          </div>
          <div className="flex flex-wrap gap-2">
            {(ring.accounts || []).map((a) => (
              <span
                key={a}
                className="font-mono text-xs px-2.5 py-1 rounded"
                style={{ background: 'var(--raised)', border: '1px solid var(--border-md)', color: 'var(--text-2)' }}
              >
                {a}
              </span>
            ))}
          </div>
        </div>

        {/* What to do */}
        <div
          className="p-4 rounded-lg"
          style={{ background: 'rgba(212,168,67,0.05)', border: '1px solid rgba(212,168,67,0.15)' }}
        >
          <div className="font-mono text-xs mb-2" style={{ color: 'var(--amber)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Recommended Action
          </div>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {desc.what_to_do}
          </p>
        </div>

      </div>
    </Sidebar>
  )
}