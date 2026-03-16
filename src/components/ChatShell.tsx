import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { ConversationList } from './ConversationList'
import { ChatPanel } from './ChatPanel'
import { ProfilePanel } from './ProfilePanel'
import { AddContactModal } from './AddContactModal'
import { CallPiP } from './CallPiP'
import { CreateGroupModal } from './CreateGroupModal'
import { GroupVoiceRoom } from './GroupVoiceRoom'
import { GroupVoicePiP } from './GroupVoicePiP'
import { groupVoice, type VoiceRoomState } from '../crypto/groupVoice'
import { VoiceInviteBanner } from './VoiceInviteBanner'

export function ChatShell() {
  const { activeConversationId } = useStore()
  const [showProfile, setShowProfile] = useState(false)
  const [showAddContact, setShowAddContact] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceRoomState | null>(() => groupVoice.getState())
  const [voiceInvite, setVoiceInvite] = useState<{ groupId: string; groupName: string; fromUserId: string; fromName: string } | null>(null)

  useEffect(() => {
    groupVoice.onStateChange = s => setVoiceState(s ? { ...s } : null)
    // Also re-render when room activity changes (someone joins/leaves a room we're watching)
    groupVoice.onRoomActivity = () => setVoiceState(s => s ? { ...s } : null)
    groupVoice.onInvite = (groupId, groupName, fromUserId, fromName) => setVoiceInvite({ groupId, groupName, fromUserId, fromName })
    groupVoice.onInviteCancel = (groupId) => setVoiceInvite(inv => inv?.groupId === groupId ? null : inv)
    return () => { groupVoice.onStateChange = null; groupVoice.onRoomActivity = null; groupVoice.onInvite = null; groupVoice.onInviteCancel = null }
  }, [])


  return (
    <div className="h-screen flex bg-white dark:bg-zinc-950 overflow-hidden">
      {/* Sidebar */}
      <div className={`w-80 flex-shrink-0 border-r border-zinc-100 dark:border-zinc-900 flex flex-col ${activeConversationId ? 'hidden md:flex' : 'flex'}`}>
        {/* Sidebar header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-900">
          <button
            onClick={() => setShowProfile(true)}
            className="flex items-center gap-2 hover:opacity-70 transition-opacity"
          >
            <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="11" width="14" height="10" rx="2" fill="white" className="dark:fill-zinc-900"/>
                <path d="M8 11V7a4 4 0 018 0v4" stroke="white" className="dark:stroke-zinc-900" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">SafeChat</span>
          </button>
          <button
            onClick={() => setShowCreateGroup(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            title="创建群聊"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/><path d="M20 8v6M23 11h-6"/>
            </svg>
          </button>
          <button
            onClick={() => setShowAddContact(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            title="添加联系人"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>

        <ConversationList />
      </div>

      {/* Chat area */}
      <div className={`flex-1 flex flex-col min-w-0 ${!activeConversationId ? 'hidden md:flex' : 'flex'}`}>
        {activeConversationId ? (
          <ChatPanel />
        ) : (
          <EmptyState onAddContact={() => setShowAddContact(true)} />
        )}
      </div>

      {showProfile && <ProfilePanel onClose={() => setShowProfile(false)} />}
      {showAddContact && <AddContactModal onClose={() => setShowAddContact(false)} />}
      {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} />}
      <CallPiP />
      <GroupVoiceRoom voiceState={voiceState} />
      <GroupVoicePiP voiceState={voiceState} />
      {voiceInvite && (
        <VoiceInviteBanner
          groupId={voiceInvite.groupId}
          groupName={voiceInvite.groupName}
          fromUserId={voiceInvite.fromUserId}
          fromName={voiceInvite.fromName}
          onDismiss={() => setVoiceInvite(null)}
        />
      )}
      <GroupVoiceRoom />
      {/* Hidden audio element for remote voice */}
      <audio id="sc-remote-audio" autoPlay playsInline style={{ display: 'none' }} />
    </div>
  )
}

function EmptyState({ onAddContact }: { onAddContact: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
      <div className="w-16 h-16 rounded-3xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-zinc-400">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      </div>
      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">选择一个对话</p>
        <p className="text-xs text-zinc-400 mt-1">或扫描好友的二维码添加联系人</p>
      </div>
      <button
        onClick={onAddContact}
        className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
      >
        添加联系人
      </button>
    </div>
  )
}
