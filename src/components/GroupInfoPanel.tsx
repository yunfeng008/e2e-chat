import { useState } from 'react'
import { useStore } from '../store'
import { clsx } from 'clsx'

interface Props { groupId: string; onClose: () => void }

function avatarColor(id: string) {
  const colors = [
    'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
    'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
    'bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300',
    'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
    'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300',
  ]
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]
}

export function GroupInfoPanel({ groupId, onClose }: Props) {
  const { conversations, identity, inviteToGroup, kickFromGroup, dissolveGroup } = useStore()
  const [tab, setTab] = useState<'members' | 'invite'>('members')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [inviting, setInviting] = useState(false)
  const [kickingId, setKickingId] = useState<string | null>(null)
  const [showDissolveConfirm, setShowDissolveConfirm] = useState(false)

  const conv = conversations.get(groupId)
  if (!conv || conv.type !== 'group') return null

  const isCreator = conv.groupInfo?.creatorId === identity?.userId
  const members = conv.groupInfo?.members ?? []
  const memberIds = new Set(members.map(m => m.userId))
  const nonMembers = Array.from(conversations.values())
    .filter(c => c.type === 'direct' && !memberIds.has(c.peerId))

  const toggleSelect = (id: string) => {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s)
  }

  const handleInvite = async () => {
    if (!selected.size) return
    setInviting(true)
    await inviteToGroup(groupId, Array.from(selected))
    setSelected(new Set())
    setInviting(false)
    setTab('members')
  }

  const handleKick = (memberId: string) => {
    setKickingId(memberId)
    kickFromGroup(groupId, memberId)
    setTimeout(() => setKickingId(null), 500)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-950 rounded-3xl w-full max-w-sm shadow-xl max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* ── 固定顶部 ───────────────────────────────────── */}
        <div className="px-6 pt-6 pb-4 flex-shrink-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">群聊信息</h2>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {/* Group avatar + name */}
          <div className="flex flex-col items-center gap-3 mb-5">
            <div className="w-14 h-14 rounded-2xl bg-violet-100 dark:bg-violet-950 grid grid-cols-2 gap-1 p-2.5">
              {[0,1,2,3].map(i => <div key={i} className="rounded-full bg-violet-400 dark:bg-violet-500" />)}
            </div>
            <div className="text-center">
              <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">{conv.peerName}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{members.length} 位成员</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex rounded-xl bg-zinc-100 dark:bg-zinc-900 p-1">
            <button onClick={() => setTab('members')} className={clsx('flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors', tab === 'members' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500')}>
              成员列表
            </button>
            <button onClick={() => setTab('invite')} className={clsx('flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors', tab === 'invite' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500')}>
              邀请成员
            </button>
          </div>
        </div>

        {/* ── 可滚动中间区 ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 min-h-0">

          {/* Members tab */}
          {tab === 'members' && (
            <div className="space-y-0.5 pb-2">
              {members.map(m => {
                const isSelf = m.userId === identity?.userId
                const isGroupCreator = m.userId === conv.groupInfo?.creatorId
                return (
                  <div key={m.userId} className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 group">
                    <div className={clsx('w-8 h-8 rounded-xl flex items-center justify-center text-xs font-medium flex-shrink-0', avatarColor(m.userId))}>
                      {m.displayName.slice(0,1).toUpperCase()}
                    </div>
                    <span className="text-sm text-zinc-900 dark:text-zinc-100 flex-1 truncate">
                      {m.displayName}{isSelf ? ' (我)' : ''}
                    </span>
                    {isGroupCreator && (
                      <span className="text-[10px] text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950 px-2 py-0.5 rounded-full flex-shrink-0">群主</span>
                    )}
                    {isCreator && !isSelf && !isGroupCreator && (
                      <button
                        onClick={() => handleKick(m.userId)}
                        disabled={kickingId === m.userId}
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-all flex-shrink-0"
                        title={`移出 ${m.displayName}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M16 11c0 2.21-1.79 4-4 4s-4-1.79-4-4 1.79-4 4-4 4 1.79 4 4z"/>
                          <path d="M2 21v-1a8 8 0 0116 0v1M22 10l-4 4m0-4l4 4"/>
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Invite tab */}
          {tab === 'invite' && (
            <div className="pb-2">
              {nonMembers.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-6">所有联系人都已在群里了</p>
              ) : nonMembers.map(c => (
                <button
                  key={c.peerId}
                  onClick={() => toggleSelect(c.peerId)}
                  className={clsx('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-colors text-left', selected.has(c.peerId) ? 'bg-zinc-100 dark:bg-zinc-900' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50')}
                >
                  <div className={clsx('w-8 h-8 rounded-xl flex items-center justify-center text-xs font-medium flex-shrink-0', avatarColor(c.peerId))}>
                    {c.peerName.slice(0,1).toUpperCase()}
                  </div>
                  <span className="flex-1 text-sm text-zinc-900 dark:text-zinc-100">{c.peerName}</span>
                  <div className={clsx('w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors', selected.has(c.peerId) ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white' : 'border-zinc-300 dark:border-zinc-700')}>
                    {selected.has(c.peerId) && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" className="dark:stroke-zinc-900" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 固定底部 ───────────────────────────────────── */}
        <div className="px-6 pb-6 pt-3 flex-shrink-0 space-y-3 border-t border-zinc-100 dark:border-zinc-900">

          {/* Invite confirm button */}
          {tab === 'invite' && (
            <button
              onClick={handleInvite}
              disabled={inviting || selected.size === 0}
              className="w-full py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-30 transition-opacity hover:opacity-90"
            >
              {inviting ? '邀请中...' : `邀请 ${selected.size} 人入群`}
            </button>
          )}

          {/* Dissolve group — creator only */}
          {isCreator && (
            showDissolveConfirm ? (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900">
                <p className="text-xs text-red-600 dark:text-red-400 text-center mb-3 font-medium">
                  确认解散「{conv.peerName}」？此操作不可恢复
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDissolveConfirm(false)}
                    className="flex-1 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => { dissolveGroup(conv.peerId); onClose() }}
                    className="flex-1 py-2 rounded-lg bg-red-500 hover:bg-red-400 text-xs text-white font-medium transition-colors"
                  >
                    确认解散
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDissolveConfirm(true)}
                className="w-full py-2.5 rounded-xl border border-red-200 dark:border-red-900 text-red-500 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              >
                解散群聊
              </button>
            )
          )}

          {/* Security note */}
          <p className="text-[11px] text-zinc-400 text-center">
            🔐 Sender Keys 端对端加密 · 服务器无法读取群消息
          </p>
        </div>

      </div>
    </div>
  )
}
