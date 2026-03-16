import { useState } from 'react'
import { groupVoice, type VoiceRoomState } from '../crypto/groupVoice'
import { clsx } from 'clsx'

function avatarColor(id: string) {
  const colors = [
    ['#E1F5EE', '#085041'], ['#E6F1FB', '#0C447C'], ['#EEEDFE', '#3C3489'],
    ['#FAEEDA', '#633806'], ['#FBEAF0', '#72243E'], ['#F1EFE8', '#444441'],
  ]
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]
}

export function GroupVoiceRoom({ voiceState }: { voiceState: VoiceRoomState | null }) {
  const state = voiceState
  const [showHostMenu, setShowHostMenu] = useState<string | null>(null)

  if (!state || state.minimized) return null

  const isHost = state.hostId === state.myUserId
  const handActive = state.handTimer > 0

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="px-5 pt-12 pb-4 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-white text-base font-medium">{state.groupName}</p>
          <p className="text-white/40 text-xs mt-0.5">{state.members.length} 人在语音中</p>
        </div>
        <button
          onClick={() => groupVoice.setMinimized(true)}
          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 transition-colors"
          title="最小化"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3"/>
          </svg>
        </button>
      </div>

      {/* Members grid */}
      <div className="flex-1 overflow-y-auto px-5">
        {state.members.length === 1 && (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="flex gap-1">
              {[0,1,2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-white/20 animate-pulse" style={{ animationDelay: `${i*0.2}s` }} />
              ))}
            </div>
            <p className="text-white/30 text-sm">等待成员加入...</p>
          </div>
        )}
        <div className={clsx('grid gap-4 py-4', state.members.length <= 2 ? 'grid-cols-2' : state.members.length <= 4 ? 'grid-cols-2' : 'grid-cols-3')}>
          {state.members.map(m => {
            const [bg, fg] = avatarColor(m.userId)
            const isSelf = m.userId === state.myUserId
            return (
              <div
                key={m.userId}
                className="flex flex-col items-center gap-2 relative"
                onClick={() => isHost && !isSelf ? setShowHostMenu(showHostMenu === m.userId ? null : m.userId) : undefined}
              >
                {/* Avatar */}
                <div className="relative">
                  <div
                    className={clsx('w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold transition-all', m.isHandRaised && 'ring-2 ring-amber-400')}
                    style={{ background: bg, color: fg, boxShadow: m.isSpeaking && !m.isMuted ? `0 0 0 3px #1D9E75` : 'none' }}
                  >
                    {m.displayName.slice(0, 1).toUpperCase()}
                  </div>

                  {/* Hand raised badge */}
                  {m.isHandRaised && (
                    <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center text-xs">
                      ✋
                    </div>
                  )}

                  {/* Muted badge */}
                  {m.isMuted && (
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e24b4a" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
                        <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4"/>
                      </svg>
                    </div>
                  )}

                  {/* Host crown */}
                  {m.isHost && (
                    <div className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center text-[9px]">👑</div>
                  )}
                </div>

                {/* Name + hand timer */}
                <div className="text-center">
                  <p className="text-white/80 text-xs font-medium truncate max-w-[72px]">
                    {m.displayName}{isSelf ? ' (我)' : ''}
                  </p>
                  {isSelf && m.isHandRaised && state.handTimer > 0 && (
                    <div className="mt-1 bg-amber-500 text-white text-[10px] font-medium rounded-full px-2 py-0.5">
                      {state.handTimer}s
                    </div>
                  )}
                </div>

                {/* Host actions popup */}
                {showHostMenu === m.userId && isHost && (
                  <div className="absolute top-0 right-0 translate-x-full ml-2 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden z-10 w-32">
                    <button
                      onClick={(e) => { e.stopPropagation(); groupVoice.forceMute(m.userId); setShowHostMenu(null) }}
                      className="w-full px-3 py-2 text-xs text-left text-white hover:bg-zinc-700 flex items-center gap-2"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 1l22 22"/></svg>
                      静音
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); groupVoice.kickFromVoice(m.userId); setShowHostMenu(null) }}
                      className="w-full px-3 py-2 text-xs text-left text-red-400 hover:bg-zinc-700 flex items-center gap-2"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      踢出
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); groupVoice.transferHost(m.userId); setShowHostMenu(null) }}
                      className="w-full px-3 py-2 text-xs text-left text-violet-400 hover:bg-zinc-700 flex items-center gap-2"
                    >
                      👑 转让主持
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="px-6 pb-12 pt-4 flex items-center justify-center gap-6 flex-shrink-0">
        {/* Mute */}
        <button
          onClick={() => groupVoice.toggleMute()}
          disabled={handActive}
          className={clsx(
            'w-14 h-14 rounded-full flex items-center justify-center transition-colors',
            state.isMuted ? 'bg-red-500/20 border border-red-500/50' : 'bg-zinc-800 hover:bg-zinc-700',
            handActive && 'opacity-40 cursor-not-allowed'
          )}
        >
          {state.isMuted ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e24b4a" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/>
              <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
              <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
            </svg>
          )}
        </button>

        {/* Leave */}
        <button
          onClick={() => groupVoice.leaveRoom()}
          className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center transition-colors"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12 12 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67m-2.67-3.34a19.79 19.79 0 01-3.07-8.63A2 2 0 014.11 2h3a2 2 0 011.72 2 12.05 12.05 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91M23 1L1 23"/>
          </svg>
        </button>

        {/* Raise hand */}
        <button
          onClick={() => groupVoice.raiseHand()}
          className={clsx(
            'w-14 h-14 rounded-full flex items-center justify-center transition-colors relative',
            handActive ? 'bg-amber-500 hover:bg-amber-400' : 'bg-zinc-800 hover:bg-zinc-700'
          )}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <path d="M18 11V6a2 2 0 00-2-2v0a2 2 0 00-2 2v5M14 10V4a2 2 0 00-2-2v0a2 2 0 00-2 2v6M10 10.5V6a2 2 0 00-2-2v0a2 2 0 00-2 2v8a6 6 0 0012 0v-3a2 2 0 00-2-2v0a2 2 0 00-2 2v0"/>
          </svg>
          {handActive && (
            <span className="absolute -top-1 -right-1 bg-amber-600 text-white text-[9px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {state.handTimer}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
