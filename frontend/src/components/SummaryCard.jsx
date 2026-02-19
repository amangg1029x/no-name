export default function SummaryCard({ label, value, sub, color, icon, delay = '' }) {
  return (
    <div className={`card fade-up ${delay} relative overflow-hidden`} style={{ padding: '20px 22px' }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-xs mb-3" style={{ color: 'var(--text-3)', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
            {label}
          </div>
          <div className="font-serif text-4xl leading-none mb-2" style={{ color }}>
            {value ?? '—'}
          </div>
          {sub && (
            <div className="font-mono text-xs leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {sub}
            </div>
          )}
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
          style={{ background: color + '12', border: `1px solid ${color}20`, color }}>
          {icon}
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0"
        style={{ height: '1px', background: `linear-gradient(90deg, ${color}50, transparent)` }} />
    </div>
  )
}