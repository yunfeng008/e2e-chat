import { useStore } from '../store'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { clsx } from 'clsx'

function getInitials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

function avatarColor(id: string) {
  const colors = [
    'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
    'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
    'bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300',
    'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
    'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300',
  ]
  let hash = 0
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff
  return colors[Math.abs(hash) % colors.length]
}

export function ConversationList() {
  const { conversations, activeConversationId, selectConversation } = useStore()
  const convList = Array.from(conversations.values()).sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0))

  if (convList.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-zinc-400">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
          </svg>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">还没有联系人<br/>点击右上角 + 添加好友</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {convList.map(conv => (
        <button
          key={conv.peerId}
          onClick={() => selectConversation(conv.peerId)}
          className={clsx(
            'w-full flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left',
            activeConversationId === conv.peerId && 'bg-zinc-50 dark:bg-zinc-900'
          )}
        >
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {(conv.type === 'group') ? (
              <div className="w-11 h-11 rounded-2xl bg-violet-100 dark:bg-violet-950 grid grid-cols-2 gap-0.5 p-2">
                {[0,1,2,3].map(i => <div key={i} className="rounded-full bg-violet-400 dark:bg-violet-500" />)}
              </div>
            ) : (
              <div className={clsx('w-11 h-11 rounded-2xl flex items-center justify-center text-sm font-medium', avatarColor(conv.peerId))}>
                {getInitials(conv.peerName)}
              </div>
            )}
            {conv.isOnline && conv.type !== 'group' && (
              <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white dark:border-zinc-950" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{conv.peerName}</span>
              {conv.lastTs && (
                <span className="text-xs text-zinc-400 flex-shrink-0 ml-2">
                  {formatDistanceToNow(conv.lastTs, { locale: zhCN, addSuffix: false })}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400 truncate">
                {conv.isTyping ? (
                  <span className="text-emerald-500">正在输入...</span>
                ) : (
                  conv.lastMessage || '开始加密对话'
                )}
              </span>
              <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                {(conv.mentionCount ?? 0) > 0 && (
                  <span className="min-w-[18px] h-[18px] rounded-full bg-emerald-500 text-white text-[10px] font-medium flex items-center justify-center px-1">
                    @
                  </span>
                )}
                {conv.unread > 0 && (
                  <span className="min-w-[18px] h-[18px] rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[10px] font-medium flex items-center justify-center px-1">
                    {conv.unread > 99 ? '99+' : conv.unread}
                  </span>
                )}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
