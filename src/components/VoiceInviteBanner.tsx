/**
 * 收到群语音邀请时底部弹出的横幅提示
 */
import { useStore } from '../store'
import { groupVoice } from '../crypto/groupVoice'

interface Props {
  groupId: string
  groupName: string
  fromUserId: string
  fromName: string
  onDismiss: () => void
}

export function VoiceInviteBanner({ groupId, groupName, fromUserId, fromName, onDismiss }: Props) {
  const { conversations, identity } = useStore()
  const conv = conversations.get(groupId)

  const handleJoin = () => {
    if (!identity || !conv || conv.type !== 'group') return
    const others = (conv.groupInfo?.members ?? []).filter(m => m.userId !== identity.userId)
    groupVoice.joinRoom(
      groupId, groupName,
      identity.userId, identity.displayName,
      conv.groupInfo!.creatorId,
      others,  // existingMembers (unused but kept for signature compat)
      []       // no inviteList — we're joining, not inviting
    ).catch(console.error)
    onDismiss()
  }

  const handleReject = () => {
    const { identity } = useStore.getState()
    if (identity) {
      // Send reject via voice_broadcast so the inviter's groupVoice receives it
      groupVoice.sendReject(groupId, identity.userId, fromUserId)
    }
    onDismiss()
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 text-white rounded-2xl px-4 py-3 flex items-center gap-4 shadow-xl border border-white/10 min-w-[280px] max-w-[360px]">
      {/* Icon */}
      <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2" strokeLinecap="round">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4"/>
        </svg>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{groupName}</p>
        <p className="text-[11px] text-white/50">{fromName} 邀请你加入语音</p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={handleReject}
          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white/70 transition-colors"
        >
          拒绝
        </button>
        <button
          onClick={handleJoin}
          className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs text-white font-medium transition-colors"
        >
          加入
        </button>
      </div>
    </div>
  )
}
