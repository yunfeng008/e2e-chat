import { useState, useRef, useEffect } from 'react'
import jsQR from 'jsqr'
import { useStore } from '../store'

interface Props { onClose: () => void }

export function AddContactModal({ onClose }: Props) {
  const { addContact } = useStore()
  const [mode, setMode] = useState<'scan' | 'paste' | 'manual'>('paste')
  const [pasteText, setPasteText] = useState('')
  const [manualId, setManualId] = useState('')
  const [manualIk, setManualIk] = useState('')
  const [manualName, setManualName] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<{ id: string; ik: string; name: string } | null>(null)
  const [error, setError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    cancelAnimationFrame(rafRef.current)
    setScanning(false)
  }

  useEffect(() => {
    if (mode === 'scan') startCamera()
    else stopCamera()
    return stopCamera
  }, [mode])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        setScanning(true)
        scanFrame()
      }
    } catch {
      setError('无法访问摄像头，请使用手动输入')
      setMode('manual')
    }
  }

  const scanFrame = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame)
      return
    }
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(imageData.data, canvas.width, canvas.height)
    if (code) {
      try {
        const data = JSON.parse(code.data)
        if (data.id && data.ik) {
          stopCamera()
          setScanned({ id: data.id, ik: data.ik, name: data.name || '未知联系人' })
          return
        }
      } catch {}
    }
    rafRef.current = requestAnimationFrame(scanFrame)
  }

  const parsePaste = (text: string): { id: string; ik: string; name: string } | null => {
    try {
      const data = JSON.parse(text.trim())
      if (data.id && data.ik) return { id: data.id, ik: data.ik, name: data.name || '未知联系人' }
    } catch {}
    return null
  }

  const handleAdd = async () => {
    if (scanned) {
      await addContact(scanned.id, scanned.ik, scanned.name)
    } else if (mode === 'paste') {
      const parsed = parsePaste(pasteText)
      if (!parsed) { setError('格式不对，请粘贴完整的联系信息'); return }
      await addContact(parsed.id, parsed.ik, parsed.name)
    } else {
      if (!manualId.trim() || !manualIk.trim() || !manualName.trim()) {
        setError('请填写所有字段')
        return
      }
      await addContact(manualId.trim(), manualIk.trim(), manualName.trim())
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-950 rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-sm shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">添加联系人</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex rounded-xl bg-zinc-100 dark:bg-zinc-900 p-1 mb-5">
          {(['paste', 'scan', 'manual'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setScanned(null); setError('') }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === m ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500'}`}>
              {m === 'paste' ? '粘贴添加' : m === 'scan' ? '扫码' : '手动'}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        {mode === 'paste' && !scanned && (
          <div className="mb-4">
            <label className="block text-xs text-zinc-500 mb-2">粘贴好友的联系信息</label>
            <textarea
              autoFocus
              value={pasteText}
              onChange={e => { setPasteText(e.target.value); setError('') }}
              placeholder='从好友那里复制的联系信息粘贴到这里...'
              rows={4}
              className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors placeholder:text-zinc-300 dark:placeholder:text-zinc-700 font-mono resize-none"
            />
            {pasteText && (() => {
              const parsed = parsePaste(pasteText)
              return parsed ? (
                <div className="mt-2 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  识别到：{parsed.name}（{parsed.id.slice(0,8)}...）
                </div>
              ) : (
                <div className="mt-2 text-xs text-red-400">格式不对，请粘贴完整的联系信息</div>
              )
            })()}
          </div>
        )}

        {mode === 'scan' && !scanned && (
          <div className="relative rounded-2xl overflow-hidden bg-zinc-900 aspect-square mb-4">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            {/* Scan frame overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-48 h-48 border-2 border-white/60 rounded-2xl relative">
                {['tl','tr','bl','br'].map(pos => (
                  <div key={pos} className={`absolute w-6 h-6 border-white border-2 ${
                    pos === 'tl' ? 'top-0 left-0 border-r-0 border-b-0 rounded-tl-lg' :
                    pos === 'tr' ? 'top-0 right-0 border-l-0 border-b-0 rounded-tr-lg' :
                    pos === 'bl' ? 'bottom-0 left-0 border-r-0 border-t-0 rounded-bl-lg' :
                    'bottom-0 right-0 border-l-0 border-t-0 rounded-br-lg'
                  }`} />
                ))}
              </div>
            </div>
            {scanning && (
              <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                <span className="text-xs text-white/70 bg-black/30 px-3 py-1 rounded-full">对准好友的二维码</span>
              </div>
            )}
          </div>
        )}

        {scanned && (
          <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-900 p-4 mb-4 text-center">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl font-semibold mx-auto mb-3">
              {scanned.name.slice(0,1).toUpperCase()}
            </div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{scanned.name}</p>
            <p className="text-xs font-mono text-zinc-400 mt-1">{scanned.id.slice(0,16).toUpperCase().match(/.{1,4}/g)?.join(' ')}</p>
            <p className="text-xs text-emerald-500 mt-2">✓ 二维码扫描成功</p>
          </div>
        )}

        {mode === 'manual' && (
          <div className="space-y-3 mb-4">
            {[
              { label: '昵称', key: 'name', placeholder: '对方的名字', val: manualName, set: setManualName },
              { label: '用户 ID', key: 'id', placeholder: '32位十六进制ID', val: manualId, set: setManualId },
              { label: '身份公钥', key: 'ik', placeholder: '64位十六进制公钥', val: manualIk, set: setManualIk },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs text-zinc-500 mb-1">{f.label}</label>
                <input
                  type="text"
                  value={f.val}
                  onChange={e => f.set(e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors placeholder:text-zinc-300 dark:placeholder:text-zinc-700 font-mono"
                />
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleAdd}
          disabled={
            !scanned &&
            (mode === 'scan' || (mode === 'paste' && !parsePaste(pasteText)))
          }
          className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-30 transition-opacity hover:opacity-90"
        >
          {scanned
            ? `添加 ${scanned.name}`
            : mode === 'paste' && parsePaste(pasteText)
            ? `添加 ${parsePaste(pasteText)!.name}`
            : mode === 'scan'
            ? '等待扫描...'
            : '添加联系人'}
        </button>
      </div>
    </div>
  )
}
