import { groupVoice, type VoiceRoomState } from '../crypto/groupVoice'

function avatarColor(id: string) {
  const colors = [
    ['#E1F5EE', '#085041'], ['#E6F1FB', '#0C447C'], ['#EEEDFE', '#3C3489'],
    ['#FAEEDA', '#633806'], ['#FBEAF0', '#72243E'], ['#F1EFE8', '#444441'],
  ]
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]
}

export function GroupVoicePiP({ voiceState }: { voiceState: VoiceRoomState | null }) {
  const state = voiceState

  if (!state || !state.minimized) return null

  const handActive = state.handTimer > 0

  return (
    <div className="fixed bottom-6 right-6 z-40 bg-zinc-900 rounded-2xl border border-white/10 shadow-2xl w-64 overflow-hidden">
      {/* Top row: avatars + group name */}
      <button
        onClick={() => groupVoice.setMinimized(false)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex flex-shrink-0">
          {state.members.slice(0, 4).map((m, i) => {
            const [bg, fg] = avatarColor(m.userId)
            return (
              <div
                key={m.userId}
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold border-2 border-zinc-900"
                style={{ background: bg, color: fg, marginLeft: i === 0 ? 0 : -6, zIndex: 10 - i }}
              >
                {m.displayName.slice(0,1).toUpperCase()}
              </div>
            )
          })}
          {state.members.length > 4 && (
            <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-[9px] text-white/60 border-2 border-zinc-900" style={{ marginLeft: -6 }}>
              +{state.members.length - 4}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-medium truncate">{state.groupName}</p>
          <p className="text-white/40 text-[10px]">语音进行中 · {state.members.length} 人</p>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" className="opacity-30 flex-shrink-0" strokeWidth="2" strokeLinecap="round">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
        </svg>
      </button>

      {/* Bottom row: controls */}
      <div className="flex items-center gap-2 px-3 pb-2.5">
        {/* Mute */}
        <button
          onClick={() => groupVoice.toggleMute()}
          disabled={handActive}
          className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-medium transition-colors ${state.isMuted ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800 text-white/70 hover:bg-zinc-700'} ${handActive ? 'opacity-40' : ''}`}
        >
          {state.isMuted ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 1l22 22"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/></svg>
          )}
          {state.isMuted ? '已静音' : '麦克风'}
        </button>

        {/* Hand */}
        <button
          onClick={() => groupVoice.raiseHand()}
          className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-medium transition-colors ${handActive ? 'bg-amber-500 text-white' : 'bg-zinc-800 text-white/70 hover:bg-zinc-700'}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 11V6a2 2 0 00-2-2v0a2 2 0 00-2 2v5M14 10V4a2 2 0 00-2-2v0a2 2 0 00-2 2v6M10 10.5V6a2 2 0 00-2-2v0a2 2 0 00-2 2v8a6 6 0 0012 0v-3a2 2 0 00-2-2v0a2 2 0 00-2 2v0"/></svg>
          {handActive ? `${state.handTimer}s` : '举手'}
        </button>

        {/* Leave */}
        <button
          onClick={() => groupVoice.leaveRoom()}
          className="w-8 h-8 rounded-lg bg-red-500 hover:bg-red-400 flex items-center justify-center flex-shrink-0 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
  )
}
