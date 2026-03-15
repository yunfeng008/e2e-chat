import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../store'

interface Props { onClose: () => void }

export function ProfilePanel({ onClose }: Props) {
  const { identity, getQRData } = useStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const data = getQRData()
    if (data && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, data, {
        width: 200,
        margin: 2,
        color: { dark: '#18181b', light: '#ffffff' },
      })
    }
  }, [])

  if (!identity) return null

  const shortId = identity.userId.slice(0, 16).toUpperCase().match(/.{1,4}/g)?.join(' ') || ''

  const handleCopy = async () => {
    const data = getQRData()
    await navigator.clipboard.writeText(data)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-950 rounded-3xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">我的身份</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Avatar */}
        <div className="flex flex-col items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 dark:bg-white flex items-center justify-center text-2xl font-semibold text-white dark:text-zinc-900">
            {identity.displayName.slice(0, 1).toUpperCase()}
          </div>
          <div className="text-center">
            <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">{identity.displayName}</p>
            <p className="text-xs font-mono text-zinc-400 mt-1">{shortId}</p>
          </div>
        </div>

        {/* QR Code */}
        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-2xl bg-white border border-zinc-100 dark:border-zinc-800">
            <canvas ref={canvasRef} />
          </div>
        </div>

        <p className="text-xs text-center text-zinc-400 mb-4">
          让好友扫描此二维码，或复制联系信息发给对方
        </p>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className={`w-full py-2.5 rounded-xl text-sm font-medium mb-4 transition-all flex items-center justify-center gap-2 ${
            copied
              ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
              : 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90'
          }`}
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
              已复制！发给好友即可
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              复制我的联系信息
            </>
          )}
        </button>

        {/* Security info */}
        <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 space-y-1.5">
          <p className="text-[11px] text-zinc-400 flex items-start gap-1.5">
            <span className="flex-shrink-0 mt-0.5">🔑</span>
            <span>身份密钥仅存储在此设备，从不上传到任何服务器</span>
          </p>
          <p className="text-[11px] text-zinc-400 flex items-start gap-1.5">
            <span className="flex-shrink-0 mt-0.5">⚠️</span>
            <span>卸载应用或清除数据将永久删除你的身份和所有消息</span>
          </p>
        </div>
      </div>
    </div>
  )
}
