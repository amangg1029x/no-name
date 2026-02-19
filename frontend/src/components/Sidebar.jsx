import { useEffect } from 'react'

export default function Sidebar({ open, onClose, title, subtitle, children }) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handle = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`sidebar-backdrop ${open ? 'open' : ''}`}
        onClick={onClose}
      />

      {/* Panel */}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="font-serif text-lg" style={{ color: 'var(--text)', lineHeight: 1.2 }}>
              {title}
            </h2>
            {subtitle && (
              <p className="font-mono text-xs mt-1" style={{ color: 'var(--text-3)', letterSpacing: '0.04em' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors ml-4 flex-shrink-0"
            style={{ color: 'var(--text-3)', background: 'rgba(255,255,255,0.04)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </aside>
    </>
  )
}