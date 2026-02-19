export default function SummaryCard({ label, value, sub, color, icon, delay = '' }) {
  return (
    <div
      className={`stat-shimmer relative overflow-hidden rounded-xl border border-border bg-card p-5 fade-in ${delay}`}
      style={{ boxShadow: `0 0 28px ${color}14` }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-slate-500 text-xs font-mono uppercase tracking-widest">
            {label}
          </p>
          <p
            className="font-display font-extrabold text-3xl leading-none"
            style={{ color, textShadow: `0 0 20px ${color}55` }}
          >
            {value ?? '—'}
          </p>
          {sub && (
            <p className="text-slate-600 text-xs font-mono mt-1">{sub}</p>
          )}
        </div>
        <span className="text-3xl opacity-50 select-none">{icon}</span>
      </div>

      {/* Bottom accent line */}
      <div
        className="absolute bottom-0 left-0 right-0 h-px opacity-50"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        }}
      />
    </div>
  )
}