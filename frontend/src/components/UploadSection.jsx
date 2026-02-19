import { useState, useRef } from 'react'

export default function UploadSection({ onUpload, loading }) {
  const [drag, setDrag] = useState(false)
  const [file, setFile] = useState(null)
  const inputRef = useRef()

  const handle = (f) => { if (!f || loading) return; setFile(f); onUpload(f) }
  const onDrop  = (e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]) }

  return (
    <div
      className={`upload-zone ${drag ? 'dragging' : ''} flex flex-col items-center justify-center gap-5 cursor-pointer select-none`}
      style={{ padding: '56px 40px', minHeight: 240 }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      onClick={() => !loading && inputRef.current.click()}
    >
      <input ref={inputRef} type="file" accept=".csv" className="hidden"
        onChange={(e) => handle(e.target.files[0])} />

      {/* Icon */}
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center transition-all duration-300"
        style={{
          background: drag ? 'rgba(212,168,67,0.1)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${drag ? 'rgba(212,168,67,0.4)' : 'rgba(255,255,255,0.09)'}`,
        }}
      >
        {loading
          ? <svg className="animate-spin w-6 h-6" style={{ color: 'var(--amber)' }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          : <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"
              style={{ color: drag ? 'var(--amber)' : 'var(--text-3)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
            </svg>
        }
      </div>

      {/* Text */}
      <div className="text-center">
        <div className="font-sans font-medium text-base mb-1.5" style={{ color: 'var(--text)' }}>
          {loading
            ? <span style={{ color: 'var(--amber)' }}>Analyzing transactions…</span>
            : file
              ? <span style={{ color: 'var(--sage)' }}>{file.name}</span>
              : drag
                ? <span style={{ color: 'var(--amber)' }}>Release to analyze</span>
                : 'Drop CSV or click to upload'}
        </div>
        <div className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>
          {loading
            ? 'Running fraud detection engine'
            : 'transaction_id · sender_id · receiver_id · amount · timestamp'}
        </div>
      </div>

      {/* Tags */}
      {!loading && (
        <div className="flex gap-2 flex-wrap justify-center">
          {['CSV', '< 50 MB', 'UTF-8'].map(t => (
            <span key={t} className="font-mono text-xs px-2.5 py-1 rounded" style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text-3)'
            }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Progress */}
      {loading && (
        <div className="w-40 rounded-full overflow-hidden" style={{ height: 2, background: 'rgba(255,255,255,0.06)' }}>
          <div className="scan-bar h-full rounded-full" style={{ background: 'var(--amber)' }} />
        </div>
      )}
    </div>
  )
}