import { useState } from 'react'
import { useStore } from '../store'

export function Onboarding() {
  const { createIdentity } = useStore()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'name' | 'generating'>('name')

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setStep('generating')
    await createIdentity(name.trim())
    setLoading(false)
  }

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-white dark:bg-zinc-950 px-8">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <div className="w-16 h-16 rounded-3xl bg-zinc-900 dark:bg-white flex items-center justify-center shadow-sm">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="11" width="14" height="10" rx="2" fill="white" className="dark:fill-zinc-900"/>
              <path d="M8 11V7a4 4 0 018 0v4" stroke="white" className="dark:stroke-zinc-900" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 text-center mb-2">
          SafeChat
        </h1>
        <p className="text-sm text-zinc-500 text-center mb-10 leading-relaxed">
          端对端加密通讯<br/>无手机号 · 无邮箱 · 无服务器存储
        </p>

        {step === 'name' ? (
          <>
            <div className="mb-6">
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                你的昵称（仅对方可见）
              </label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="起个名字..."
                maxLength={24}
                className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors placeholder:text-zinc-300 dark:placeholder:text-zinc-700"
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={!name.trim() || loading}
              className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-30 transition-opacity hover:opacity-90 active:scale-[0.98] transition-transform"
            >
              生成加密身份
            </button>

            <div className="mt-8 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
              <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed space-y-1">
                <span className="block">🔐 密钥在设备本地生成，从不上传</span>
                <span className="block">👻 完全匿名，无需任何个人信息</span>
                <span className="block">🔥 支持消息阅后即焚</span>
              </p>
            </div>
          </>
        ) : (
          <div className="text-center py-8">
            <div className="flex justify-center gap-1.5 mb-6">
              {[0,1,2,3,4].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">正在生成密钥对...</p>
            <p className="text-xs text-zinc-400 mt-1">X25519 + Ed25519 · Double Ratchet</p>
          </div>
        )}
      </div>
    </div>
  )
}
