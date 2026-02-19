import { useState, useRef } from 'react'

export default function UploadSection({ onUpload, loading }) {
  const [drag, setDrag] = useState(false)
  const [file, setFile] = useState(null)
  const inputRef = useRef()

  const handle = (f) => {
    if (!f || loading) return
    setFile(f)
    onUpload(f)
  }

  const onDragOver  = (e) => { e.preventDefault(); setDrag(true) }
  const onDragLeave = ()  => setDrag(false)
  const onDrop      = (e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]) }
  const onClick     = ()  => { if (!loading) inputRef.current.click() }

  return (
    <div className="upload-border w-full">
      <div
        className={`upload-inner ${drag ? 'active' : ''} flex flex-col items-center justify-center gap-5 py-14 px-8 cursor-pointer select-none`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onClick}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => handle(e.target.files[0])}
        />

        {/* Icon ring */}
        <div className="relative w-20 h-20 flex items-center justify-center">
          <div
            className={`w-20 h-20 rounded-full border-2 flex items-center justify-center transition-all duration-300
              ${drag ? 'border-cblue scale-110' : 'border-cblue/40'}`}
            style={{ boxShadow: drag ? '0 0 40px rgba(0,212,255,0.5)' : '0 0 18px rgba(0,212,255,0.2)' }}
          >
            {loading ? (
              <svg className="animate-spin w-8 h-8 text-cblue" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg className="w-9 h-9 text-cblue" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            )}
          </div>
        </div>

        {/* Label */}
        <div className="text-center">
          <p className="font-display font-extrabold text-xl text-slate-100">
            {loading ? (
              <span className="cursor text-cblue">Analyzing</span>
            ) : file ? (
              <span className="text-cgreen">{file.name}</span>
            ) : drag ? (
              <span className="text-cblue">Release to analyze</span>
            ) : (
              'Drop CSV or click to upload'
            )}
          </p>
          <p className="text-slate-500 font-mono text-xs mt-1.5">
            {loading
              ? 'Running fraud detection engine…'
              : 'transaction_id · sender_id · receiver_id · amount · timestamp'}
          </p>
        </div>

        {/* Tags */}
        {!loading && (
          <div className="flex gap-3 flex-wrap justify-center">
            {['CSV format', '< 50 MB', 'UTF-8 encoded'].map((t) => (
              <span
                key={t}
                className="text-xs font-mono px-3 py-1 rounded-full border border-cblue/20 text-cblue/60"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Progress bar */}
        {loading && (
          <div className="w-52 h-1 bg-border rounded-full overflow-hidden">
            <div
              className="progress-bar h-full rounded-full"
              style={{ background: 'linear-gradient(90deg,#ff3366,#00d4ff,#00ff88)' }}
            />
          </div>
        )}
      </div>
    </div>
  )
}