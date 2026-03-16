import { useState } from 'react'
import { useStore } from '../store'
import { groupVoice } from '../crypto/groupVoice'
import { clsx } from 'clsx'

interface Props {
  groupId: string
  onClose: () => void
}

function avatarColor(id: string) {
  const colors = [
    ['#E1F5EE','#085041'],['#E6F1FB','#0C447C'],['#EEEDFE','#3C3489'],
    ['#FAEEDA','#633806'],['#FBEAF0','#72243E'],['#F1EFE8','#444441'],
  ]
  let h = 0; for (const c of id) h = (h*31+c.charCodeAt(0))&0xffffffff
  return colors[Math.abs(h)%colors.length]
}

export function VoiceInviteModal({ groupId, onClose }: Props) {
  const { conversations, identity } = useStore()
  const conv = conversations.get(groupId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [starting, setStarting] = useState(false)

  if (!conv || conv.type !== 'group' || !identity) return null

  const members = (conv.groupInfo?.members ?? []).filter(m => m.userId !== identity.userId)

  const toggleAll = () => {
    if (selected.size === members.length) setSelected(new Set())
    else setSelected(new Set(members.map(m => m.userId)))
  }

  const toggle = (id: string) => {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s)
  }

  const handleStart = async () => {
    setStarting(true)
    const invitedMembers = members.filter(m => selected.has(m.userId))
    try {
      await groupVoice.joinRoom(
        groupId, conv.peerName,
        identity.userId, identity.displayName,
        conv.groupInfo!.creatorId,
        invitedMembers,  // only pass selected members to connect with
        Array.from(selected) // invite list to broadcast
      )
      onClose()
    } catch (e) {
      console.error(e)
      setStarting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-950 rounded-t-3xl sm:rounded-3xl w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-zinc-100 dark:border-zinc-900">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">发起群语音</h2>
            <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <p className="text-xs text-zinc-400">{conv.peerName} · 选择邀请谁加入</p>
        </div>

        {/* All toggle */}
        <div className="px-6 py-3 border-b border-zinc-100 dark:border-zinc-900">
          <button
            onClick={toggleAll}
            className="w-full flex items-center gap-3 py-1 text-left"
          >
            <div className={clsx(
              'w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors',
              selected.size === members.length ? 'bg-zinc-900 dark:bg-white' : 'bg-zinc-100 dark:bg-zinc-800'
            )}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke={selected.size === members.length ? 'white' : 'currentColor'}
                className={selected.size === members.length ? '' : 'text-zinc-400'}
                strokeWidth="1.5" strokeLinecap="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">邀请所有人</p>
              <p className="text-xs text-zinc-400">{members.length} 位成员</p>
            </div>
            <div className={clsx(
              'w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors',
              selected.size === members.length ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white' : 'border-zinc-300 dark:border-zinc-700'
            )}>
              {selected.size === members.length && (
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" className="dark:stroke-zinc-900" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
              )}
            </div>
          </button>
        </div>

        {/* Member list */}
        <div className="px-6 py-3 max-h-52 overflow-y-auto">
          {members.map(m => {
            const [bg, fg] = avatarColor(m.userId)
            return (
              <button
                key={m.userId}
                onClick={() => toggle(m.userId)}
                className="w-full flex items-center gap-3 py-2 text-left hover:opacity-80 transition-opacity"
              >
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0" style={{ background: bg, color: fg }}>
                  {m.displayName.slice(0,1).toUpperCase()}
                </div>
                <span className="flex-1 text-sm text-zinc-900 dark:text-zinc-100">{m.displayName}</span>
                <div className={clsx(
                  'w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors',
                  selected.has(m.userId) ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white' : 'border-zinc-300 dark:border-zinc-700'
                )}>
                  {selected.has(m.userId) && (
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" className="dark:stroke-zinc-900" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 pb-8 pt-3 border-t border-zinc-100 dark:border-zinc-900">
          <button
            onClick={handleStart}
            disabled={starting}
            className="w-full py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-50 transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4"/>
            </svg>
            {starting ? '正在发起...' : selected.size === 0 ? '仅自己等待' : `发起并邀请 ${selected.size} 人`}
          </button>
          <p className="text-[11px] text-zinc-400 text-center mt-2">
            {selected.size === 0 ? '你将进入等待状态，群成员可随时加入' : '被邀请的成员会收到加入提示'}
          </p>
        </div>
      </div>
    </div>
  )
}
