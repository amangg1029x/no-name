export default function DownloadButton({ data, disabled }) {
  const handleDownload = () => {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a   = document.createElement('a')
    a.href     = url
    a.download = `fraud_results_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleDownload}
      disabled={disabled || !data}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-xl border font-ui font-semibold text-sm
        transition-all duration-200
        ${data && !disabled
          ? 'border-cgreen/30 bg-cgreen/10 text-cgreen hover:bg-cgreen/20 glow-green cursor-pointer'
          : 'border-border bg-transparent text-slate-600 cursor-not-allowed opacity-40'}
      `}
    >
      {/* Download icon */}
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
        />
      </svg>
      Export JSON
    </button>
  )
}