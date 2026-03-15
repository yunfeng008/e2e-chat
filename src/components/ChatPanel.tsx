import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore, type Message } from '../store'
import { voiceCall } from '../crypto/voiceCall'
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

export function ChatPanel() {
  const { identity, conversations, activeConversationId, sendMessage, setDefaultTtl, defaultTtl } = useStore()
  const [input, setInput] = useState('')
  const [showTtl, setShowTtl] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
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
            <span className={clsx(
              'text-xs px-1.5 py-0.5 rounded-md font-medium',
              conv.isOnline
                ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-400'
            )}>
              {conv.isOnline ? '在线' : '离线'}
            </span>
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
              setInput(e.target.value)
              handleTyping()
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            placeholder="输入消息... (Enter 发送)"
            rows={1}
            className="flex-1 resize-none py-2 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none max-h-[120px] overflow-y-auto leading-relaxed"
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-zinc-900 dark:bg-white flex items-center justify-center disabled:opacity-30 transition-opacity hover:opacity-80"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" className="dark:stroke-zinc-900" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
      </div>
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

function MessageBubble({ msg, isMine, showTs, onImageClick }: { msg: Message; isMine: boolean; showTs: boolean; onImageClick?: (src: string) => void }) {
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
            msg.content
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
