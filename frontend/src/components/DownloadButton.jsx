export default function DownloadButton({ data, disabled }) {
  const handleDownload = () => {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `fraud_analysis_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const enabled = data && !disabled

  return (
    <button
      onClick={handleDownload}
      disabled={!enabled}
      className="flex items-center gap-2 font-mono text-xs px-4 py-2 rounded-lg transition-all"
      style={{
        background: enabled ? 'rgba(74,124,89,0.12)' : 'transparent',
        border: `1px solid ${enabled ? 'rgba(74,124,89,0.3)' : 'var(--border)'}`,
        color: enabled ? '#6aad82' : 'var(--text-3)',
        cursor: enabled ? 'pointer' : 'not-allowed',
        opacity: enabled ? 1 : 0.45,
      }}
      onMouseEnter={e => { if (enabled) e.currentTarget.style.background = 'rgba(74,124,89,0.18)' }}
      onMouseLeave={e => { if (enabled) e.currentTarget.style.background = 'rgba(74,124,89,0.12)' }}
    >
      <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
      </svg>
      Export JSON
    </button>
  )
}