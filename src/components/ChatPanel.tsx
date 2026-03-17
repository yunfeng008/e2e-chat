import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore, type Message } from '../store'
import { GroupInfoPanel } from './GroupInfoPanel'
import { VoiceInviteModal } from './VoiceInviteModal'
import { voiceCall } from '../crypto/voiceCall'
import { groupVoice } from '../crypto/groupVoice'
import { network } from '../crypto/network'
import { clsx } from 'clsx'
import { format } from 'date-fns'

const TTL_OPTIONS = [
  { label: '关闭', value: null },
  { label: '5秒', value: 5_000 },
  { label: '1分钟', value: 60_000 },
  { label: '1小时', value: 3_600_000 },
  { label: '24小时', value: 86_400_000 },
]

export function ChatPanel({ roomActivityTick: _tick = 0 }: { roomActivityTick?: number }) {
  const { identity, conversations, activeConversationId, sendMessage, setDefaultTtl, defaultTtl } = useStore()
  const [input, setInput] = useState('')
  const [showTtl, setShowTtl] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [showGroupInfo, setShowGroupInfo] = useState(false)
  const [showVoiceInvite, setShowVoiceInvite] = useState(false)
  const [, forceInviteUpdate] = useState(0)
  useEffect(() => {
    // Invite/cancel events also need to re-render the voice button (hasPendingInvite)
    const prevInvite = groupVoice.onInvite
    const prevCancel = groupVoice.onInviteCancel
    groupVoice.onInvite = (gid, gn, fuid, fn) => { forceInviteUpdate(n => n + 1); prevInvite?.(gid, gn, fuid, fn) }
    groupVoice.onInviteCancel = (gid) => { forceInviteUpdate(n => n + 1); prevCancel?.(gid) }
    return () => {
      groupVoice.onInvite = prevInvite
      groupVoice.onInviteCancel = prevCancel
    }
  }, [])
  // _tick from ChatShell drives re-render when room activity changes (even when ChatPanel was unmounted)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null) // null=closed, string=search
  const [mentionIndex, setMentionIndex] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const conv = activeConversationId ? conversations.get(activeConversationId) : null

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conv?.messages.length])

  const handleTyping = useCallback(() => {
    if (!activeConversationId) return
    network.sendTyping(activeConversationId, true)
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      network.sendTyping(activeConversationId, false)
    }, 2000)
  }, [activeConversationId])

  const handleSend = async () => {
    if (!input.trim() || !activeConversationId) return
    const text = input.trim()
    setInput('')
    inputRef.current!.style.height = 'auto'
    await sendMessage(activeConversationId, text)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeConversationId) return
    if (file.size > 10 * 1024 * 1024) { alert('文件最大 10MB'); return }

    const reader = new FileReader()
    reader.onload = async (ev) => {
      const base64 = (ev.target?.result as string).split(',')[1]
      const isImage = file.type.startsWith('image/')
      await sendMessage(
        activeConversationId,
        isImage ? '[图片]' : `[文件] ${file.name}`,
        isImage ? 'image' : 'file',
        base64,
        file.name,
        file.size,
        file.type
      )
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  if (!conv) return null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-900 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{conv.peerName}</span>
            {conv.type === 'group' ? (
              <span className="text-xs px-1.5 py-0.5 rounded-md font-medium bg-violet-50 dark:bg-violet-950 text-violet-600 dark:text-violet-400">
                {conv.groupInfo?.members?.length ?? 0} 人
              </span>
            ) : (
              <span className={clsx(
                'text-xs px-1.5 py-0.5 rounded-md font-medium',
                conv.isOnline
                  ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                  : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-400'
              )}>
                {conv.isOnline ? '在线' : '离线'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="text-emerald-500">
              <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/>
              <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-[11px] text-zinc-400">端对端加密 · 消息不经服务器</span>
          </div>
        </div>

        {/* Voice call button */}
        <button
          title={conv.isOnline ? '发起语音通话' : '对方不在线，无法发起通话'}
          onClick={() => {
            if (!conv.isOnline) return
            const { identity } = useStore.getState()
            voiceCall.call(conv.peerId, conv.peerName, identity?.displayName ?? '我').catch(console.error)
          }}
          className={clsx(
            'w-8 h-8 rounded-lg flex items-center justify-center transition-colors flex-shrink-0',
            conv.isOnline ? 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer' : 'text-zinc-200 dark:text-zinc-800 cursor-not-allowed'
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.22 1.18 2 2 0 012.18 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.18 6.18l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
        </button>

        {/* Group voice button — one button: start if no room, join if room exists, disabled if already in room */}
        {(conv.type === 'group') && !conv.kicked && (() => {
          const alreadyInRoom = !!groupVoice.getState()
          const pendingInvite = groupVoice.hasPendingInvite(conv.peerId)
          const roomExists = groupVoice.isRoomActive(conv.peerId)
          const initiator = groupVoice.getRoomInitiator(conv.peerId)
          const label = alreadyInRoom ? '已在语音中' : pendingInvite ? '有待处理的邀请' : roomExists ? `加入 ${initiator} 的语音` : '发起群语音'
          const disabled = alreadyInRoom || pendingInvite
          return (
            <button
              onClick={() => {
                if (disabled) return
                if (roomExists) {
                  // Room already active — join directly
                  const { identity } = useStore.getState()
                  if (!identity || !conv.groupInfo) return
                  const otherMembers = conv.groupInfo.members.filter(m => m.userId !== identity.userId)
                  groupVoice.joinRoom(conv.peerId, conv.peerName, identity.userId, identity.displayName, conv.groupInfo.creatorId, otherMembers).catch(console.error)
                } else {
                  // No room — open invite picker
                  setShowVoiceInvite(true)
                }
              }}
              disabled={disabled}
              className={clsx(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-colors flex-shrink-0',
                disabled ? 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed' :
                roomExists ? 'text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950' :
                'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'
              )}
              title={label}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
              </svg>
            </button>
          )
        })()}

        {/* Group info button — only shown for group conversations, hidden if kicked */}
        {(conv.type === 'group') && !conv.kicked && (
          <button
            onClick={() => setShowGroupInfo(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors flex-shrink-0"
            title="群聊信息 · 加人 / 踢人"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
          </button>
        )}

        {/* Burn timer toggle */}
        <div className="relative">
          <button
            onClick={() => setShowTtl(!showTtl)}
            className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
              defaultTtl ? 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'
            )}
            title="阅后即焚设置"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M12 2c0 0-3 4-3 8a3 3 0 006 0c0-4-3-8-3-8z"/>
              <path d="M12 10c0 0-1.5 2-1.5 4a1.5 1.5 0 003 0c0-2-1.5-4-1.5-4z" fill="currentColor"/>
            </svg>
          </button>
          {showTtl && (
            <div className="absolute right-0 top-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg z-10 py-1 min-w-[120px]">
              {TTL_OPTIONS.map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => { setDefaultTtl(opt.value); setShowTtl(false) }}
                  className={clsx(
                    'w-full px-4 py-2 text-xs text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors',
                    defaultTtl === opt.value ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-500'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
        {conv.messages.length === 0 && (
          <div className="flex justify-center py-8">
            <div className="text-center px-6 py-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900">
              <p className="text-xs text-zinc-400 leading-relaxed">
                消息使用 Signal Protocol 端对端加密<br/>
                即使服务器被入侵也无法读取你的消息
              </p>
            </div>
          </div>
        )}

        {conv.messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isMine={msg.senderId === identity?.userId}
            showTs={i === 0 || msg.ts - conv.messages[i-1].ts > 300_000}
            onImageClick={setLightbox}
            senderName={(conv.type === 'group') && msg.senderId !== identity?.userId
              ? ((conv.groupInfo?.members ?? []).find(m => m.userId === msg.senderId)?.displayName ?? msg.senderId.slice(0,8))
              : undefined}
            myDisplayName={identity?.displayName}
          />
        ))}

        {conv.isTyping && (
          <div className="flex items-end gap-2">
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                {[0,1,2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* @ mention autocomplete popup */}
      {mentionQuery !== null && (conv.type === 'group') && (() => {
        const isCreator = conv.groupInfo?.creatorId === identity?.userId
        const allOpt = { userId: 'all', displayName: 'all', identityKeyHex: '' }
        const filtered = [...(isCreator ? [allOpt] : []), ...(conv.groupInfo?.members ?? []).filter(m => m.userId !== identity?.userId)]
          .filter(m => m.displayName.toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 6)
        if (!filtered.length) return null
        return (
          <div className="mx-4 mb-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
            {filtered.map((m, i) => (
              <button
                key={m.userId}
                onMouseDown={e => {
                  e.preventDefault()
                  const atPos = input.lastIndexOf('@' + mentionQuery)
                  const before = input.slice(0, atPos)
                  const after = input.slice(atPos + mentionQuery.length + 1)
                  setInput(before + '@' + m.displayName + ' ' + after)
                  setMentionQuery(null)
                  setMentionIndex(0)
                  setTimeout(() => inputRef.current?.focus(), 0)
                }}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                  i === mentionIndex ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                )}
              >
                {m.userId === 'all' ? (
                  <span className="w-6 h-6 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center flex-shrink-0">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" className="dark:stroke-zinc-900" strokeWidth="2" strokeLinecap="round">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                  </span>
                ) : (
                  <span className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[10px] font-medium text-zinc-600 dark:text-zinc-300 flex-shrink-0">
                    {m.displayName.slice(0,1).toUpperCase()}
                  </span>
                )}
                <span className="text-zinc-900 dark:text-zinc-100 flex-1 font-medium text-xs">{m.displayName}</span>
                {m.userId === 'all' && <span className="text-[10px] text-zinc-400">通知所有人</span>}
                {i === mentionIndex && <kbd className="text-[9px] text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded px-1">↵</kbd>}
              </button>
            ))}
          </div>
        )
      })()}

      {/* Input */}
      <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-900">
        {defaultTtl && (
          <div className="flex items-center gap-1 mb-2 px-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500">
              <path d="M12 2c0 0-3 4-3 8a3 3 0 006 0c0-4-3-8-3-8z"/>
            </svg>
            <span className="text-[10px] text-amber-500 font-medium">
              阅后即焚 · {TTL_OPTIONS.find(o => o.value === defaultTtl)?.label}后销毁
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* File upload */}
          <label className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer transition-colors">
            <input type="file" className="hidden" onChange={handleFileUpload} accept="image/*,.pdf,.txt,.zip" />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
            </svg>
          </label>

          {/* Text input */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => {
              const val = e.target.value
              setInput(val)
              handleTyping()
              // @ mention detection
              const cursor = e.target.selectionStart ?? val.length
              const before = val.slice(0, cursor)
              const atMatch = before.match(/@(\w*)$/)
              if (atMatch) { setMentionQuery(atMatch[1]); setMentionIndex(0) }
              else setMentionQuery(null)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
            onKeyDown={e => {
              // @ mention keyboard navigation
              if (mentionQuery !== null && conv.type === 'group') {
                const isCreatorKb = conv.groupInfo?.creatorId === identity?.userId
                const allOpt = { userId: 'all', displayName: 'all', identityKeyHex: '' }
                const filtered = [...(isCreatorKb ? [allOpt] : []), ...(conv.groupInfo?.members ?? []).filter(m => m.userId !== identity?.userId)]
                  .filter(m => m.displayName.toLowerCase().includes(mentionQuery.toLowerCase()))
                  .slice(0, 6)
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setMentionIndex(i => Math.min(i + 1, filtered.length - 1))
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setMentionIndex(i => Math.max(i - 1, 0))
                  return
                }
                if (e.key === 'Enter' && filtered[mentionIndex]) {
                  e.preventDefault()
                  const m = filtered[mentionIndex]
                  const atPos = input.lastIndexOf('@' + mentionQuery)
                  const before = input.slice(0, atPos)
                  const after = input.slice(atPos + mentionQuery.length + 1)
                  setInput(before + '@' + m.displayName + ' ' + after)
                  setMentionQuery(null)
                  setMentionIndex(0)
                  return
                }
                if (e.key === 'Escape') {
                  setMentionQuery(null)
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            placeholder={conv.kicked ? "你已被移出该群聊" : "输入消息... (Enter 发送)"}
            disabled={!!conv.kicked}
            rows={1}
            className="flex-1 resize-none py-2 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none max-h-[120px] overflow-y-auto leading-relaxed"
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!input.trim() || !!conv.kicked}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center disabled:opacity-30 transition-opacity hover:opacity-80"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" className="dark:stroke-zinc-900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>
      {showGroupInfo && (conv.type === 'group') && (
        <GroupInfoPanel groupId={conv.peerId} onClose={() => setShowGroupInfo(false)} />
      )}
      {showVoiceInvite && (conv.type === 'group') && (
        <VoiceInviteModal groupId={conv.peerId} onClose={() => setShowVoiceInvite(false)} />
      )}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="图片预览"
            className="max-w-full max-h-full rounded-xl object-contain"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

function MentionText({ text, myName }: { text: string; myName?: string }) {
  const parts = text.split(/(@\S+)/g)
  return (
    <span>
      {parts.map((p, i) => {
        if (!p.startsWith('@')) return p
        const name = p.slice(1)
        const isMe = myName && name === myName
        const isAll = name.toLowerCase() === 'all'
        if (isMe || isAll) {
          return <span key={i} className="bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 font-medium rounded px-0.5">{p}</span>
        }
        return <span key={i} className="text-zinc-600 dark:text-zinc-400 font-medium">{p}</span>
      })}
    </span>
  )
}

function MessageBubble({ msg, isMine, showTs, onImageClick, senderName, myDisplayName }: { msg: Message; isMine: boolean; showTs: boolean; onImageClick?: (src: string) => void; senderName?: string; myDisplayName?: string }) {
  if (msg.type === 'system') {
    return (
      <div className="flex justify-center py-2">
        <span className="text-[11px] text-zinc-400 bg-zinc-50 dark:bg-zinc-900 px-3 py-1 rounded-full">{msg.content}</span>
      </div>
    )
  }

  return (
    <div className={clsx('flex flex-col', isMine ? 'items-end' : 'items-start')}>
      {showTs && (
        <span className="text-[10px] text-zinc-400 mb-2 px-2">
          {format(msg.ts, 'MM/dd HH:mm')}
        </span>
      )}
      <div className={clsx('max-w-[72%] group')}>
        {senderName && !isMine && (
          <div className="text-[11px] text-zinc-400 mb-0.5 px-1">{senderName}</div>
        )}
        <div className={clsx(
          'px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words',
          isMine
            ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-br-md'
            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-md'
        )}>
          {msg.type === 'image' && msg.fileData ? (
            <img
              src={`data:${msg.fileMimeType};base64,${msg.fileData}`}
              alt="图片"
              onClick={() => onImageClick?.(`data:${msg.fileMimeType};base64,${msg.fileData}`)}
              className="max-w-full rounded-lg max-h-64 object-cover cursor-zoom-in"
            />
          ) : msg.type === 'file' ? (
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <path d="M14 2v6h6"/>
              </svg>
              <div>
                <div className="text-xs font-medium">{msg.fileName}</div>
                {msg.fileSize && <div className="text-[10px] opacity-60">{(msg.fileSize / 1024).toFixed(1)} KB</div>}
              </div>
            </div>
          ) : (
            <MentionText text={msg.content} myName={myDisplayName} />
          )}
        </div>
        <div className={clsx('flex items-center gap-1 mt-0.5 px-1', isMine ? 'justify-end' : 'justify-start')}>
          {msg.ttl && (
            <span className="text-[10px] text-amber-400">🔥</span>
          )}
          {isMine && (
            <span className="text-[10px] text-zinc-400">
              {msg.status === 'sent' ? '✓' : msg.status === 'delivered' ? '✓✓' : '✓✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
