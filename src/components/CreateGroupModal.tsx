import { useState } from 'react'
import { useStore } from '../store'
import { clsx } from 'clsx'

interface Props { onClose: () => void }

function avatarColor(id: string) {
  const colors = [
    'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
    'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
    'bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300',
    'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
    'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300',
  ]
  let h = 0; for (const c of id) h = (h*31 + c.charCodeAt(0)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]
}

export function CreateGroupModal({ onClose }: Props) {
  const { conversations, createGroup } = useStore()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 只从一对一联系人里选
  const contacts = Array.from(conversations.values()).filter(c => c.type === 'direct')

  const toggle = (id: string) => {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.size < 99 ? s.add(id) : null
    setSelected(s)
  }

  const handleCreate = async () => {
    if (!name.trim()) { setError('请填写群名'); return }
    if (selected.size < 1) { setError('至少选择 1 位成员'); return }
    setLoading(true)
    try {
      await createGroup(name.trim(), Array.from(selected))
      onClose()
    } catch (e) {
      console.error('createGroup failed:', e)
      setError('创建失败：' + (e instanceof Error ? e.message : String(e)))
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-950 rounded-t-3xl sm:rounded-3xl p-6 w-full max-w-sm shadow-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-shrink-0">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">创建群聊</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* 群名 */}
        <div className="mb-4 flex-shrink-0">
          <label className="block text-xs text-zinc-500 mb-1.5">群名称</label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="给群起个名字..."
            maxLength={32}
            className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-400 dark:focus:border-zinc-600 transition-colors placeholder:text-zinc-300 dark:placeholder:text-zinc-700"
          />
        </div>

        {/* 成员选择 */}
        <div className="flex-shrink-0 mb-2">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-zinc-500">选择成员（{selected.size}/99）</label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
          {contacts.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-6">还没有联系人，先添加好友吧</p>
          ) : (
            contacts.map(c => (
              <button
                key={c.peerId}
                onClick={() => toggle(c.peerId)}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-colors text-left',
                  selected.has(c.peerId) ? 'bg-zinc-100 dark:bg-zinc-900' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                )}
              >
                <div className={clsx('w-8 h-8 rounded-xl flex items-center justify-center text-xs font-medium flex-shrink-0', avatarColor(c.peerId))}>
                  {c.peerName.slice(0,1).toUpperCase()}
                </div>
                <span className="flex-1 text-sm text-zinc-900 dark:text-zinc-100">{c.peerName}</span>
                <div className={clsx(
                  'w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors',
                  selected.has(c.peerId) ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white' : 'border-zinc-300 dark:border-zinc-700'
                )}>
                  {selected.has(c.peerId) && (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" className="dark:stroke-zinc-900" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {error && <p className="text-xs text-red-500 mt-3 flex-shrink-0">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={loading || !name.trim() || selected.size === 0}
          className="mt-4 w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-30 transition-opacity hover:opacity-90 flex-shrink-0"
        >
          {loading ? '创建中...' : `创建群聊（${selected.size + 1} 人）`}
        </button>
      </div>
    </div>
  )
}
