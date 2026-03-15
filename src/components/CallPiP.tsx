import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { voiceCall, type CallSession } from '../crypto/voiceCall'
import { clsx } from 'clsx'

function formatDuration(startedAt?: number) {
  if (!startedAt) return '00:00'
  const s = Math.floor((Date.now() - startedAt) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function CallPiP() {
  const [session, setSession] = useState<CallSession | null>(() => voiceCall.getSession())
  const [expanded, setExpanded] = useState(false)
  const [timer, setTimer] = useState('00:00')
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)

  // 用 ref 存 setter，注册一次稳定的回调，不受严格模式 remount 影响
  const setSessionRef = useRef(setSession)
  const setExpandedRef = useRef(setExpanded)
  useLayoutEffect(() => { setSessionRef.current = setSession }, [setSession])
  useLayoutEffect(() => { setExpandedRef.current = setExpanded }, [setExpanded])

  useLayoutEffect(() => {
    // 稳定回调：不会因 remount 被清掉
    voiceCall.onStateChange = (s) => {
      setSessionRef.current(s ? { ...s } : null)
      if (!s) setExpandedRef.current(false)
    }
    // 立刻同步一次当前状态
    const existing = voiceCall.getSession()
    setSessionRef.current(existing ? { ...existing } : null)
    // 注意：不清除 onStateChange，保持常驻
    return () => {}
  }, []) // 空依赖，只跑一次，永不清除



  // 计时器
  useEffect(() => {
    if (session?.state !== 'connected') return
    const id = setInterval(() => setTimer(formatDuration(session.startedAt)), 500)
    return () => clearInterval(id)
  }, [session?.state, session?.startedAt])

  // 拖拽（只在小窗模式）
  const onPipMouseDown = (e: React.MouseEvent) => {
    if (expanded) return
    if ((e.target as HTMLElement).closest('button')) return // 点按钮不触发拖拽
    e.preventDefault()
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y }
    const move = (ev: MouseEvent) => {
      if (!dragStart.current) return
      setPos({ x: dragStart.current.px + ev.clientX - dragStart.current.mx, y: dragStart.current.py + ev.clientY - dragStart.current.my })
    }
    const up = () => { dragStart.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (!session) return null

  const statusLabel =
    session.state === 'outgoing' ? '等待接听...' :
    session.state === 'incoming' ? '来电...' :
    session.state === 'connected' ? timer : '连接中...'

  // ── 全屏模式 ───────────────────────────────────────────────────────────────
  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col items-center justify-center gap-8">
        <button
          onClick={() => setExpanded(false)}
          className="absolute top-5 right-5 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/>
          </svg>
        </button>

        <div className="relative w-28 h-28 flex items-center justify-center">
          {session.state !== 'connected' && (
            <>
              <div className="absolute w-32 h-32 rounded-full border border-white/15 animate-ping" style={{ animationDuration: '2s' }} />
              <div className="absolute w-36 h-36 rounded-full border border-white/8 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.4s' }} />
            </>
          )}
          <div className="w-28 h-28 rounded-full bg-zinc-700 flex items-center justify-center text-5xl font-semibold text-white">
            {session.peerName.slice(0, 1).toUpperCase()}
          </div>
        </div>

        <div className="text-center">
          <p className="text-white text-2xl font-medium">{session.peerName}</p>
          <p className="text-white/50 text-sm mt-1 font-mono">{statusLabel}</p>
        </div>

        <Buttons session={session} size="lg" />
      </div>
    )
  }

  // ── 画中画模式 ─────────────────────────────────────────────────────────────
  return (
    <div
      onMouseDown={onPipMouseDown}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      className="fixed bottom-6 right-6 z-40 w-56 bg-zinc-900 rounded-2xl border border-white/10 shadow-2xl select-none cursor-move"
    >
      {/* 顶部信息栏 */}
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">
          {session.peerName.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-medium truncate">{session.peerName}</p>
          <p className="text-white/40 text-[10px] font-mono leading-tight mt-0.5">{statusLabel}</p>
        </div>
        {/* 放大按钮 */}
        <button
          onClick={() => setExpanded(true)}
          className="w-6 h-6 rounded-md flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors flex-shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
          </svg>
        </button>
      </div>

      {/* 按钮区 — stopPropagation 防止拖拽捕获按钮点击 */}
      <div className="px-3 pb-3 flex justify-center" onMouseDown={e => e.stopPropagation()}>
        <Buttons session={session} size="sm" />
      </div>
    </div>
  )
}

// ── 通话按钮组 ──────────────────────────────────────────────────────────────

function Buttons({ session, size }: { session: CallSession; size: 'sm' | 'lg' }) {
  const sz = size === 'lg' ? 'w-16 h-16 rounded-full' : 'w-10 h-10 rounded-full'
  const ic = size === 'lg' ? 22 : 16

  if (session.state === 'incoming') {
    return (
      <div className="flex gap-8">
        <button
          onClick={(e) => { e.stopPropagation(); voiceCall.reject() }}
          className={clsx(sz, 'bg-red-500 hover:bg-red-400 flex items-center justify-center transition-colors')}
        >
          <IcoPhoneOff size={ic} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); voiceCall.accept() }}
          className={clsx(sz, 'bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center transition-colors')}
        >
          <IcoPhone size={ic} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      {session.state === 'connected' && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); voiceCall.toggleMute() }}
            className={clsx(
              sz, 'flex items-center justify-center transition-colors',
              session.isMuted ? 'bg-amber-500 hover:bg-amber-400' : 'bg-zinc-700 hover:bg-zinc-600'
            )}
          >
            {session.isMuted ? <IcoMicOff size={ic} /> : <IcoMic size={ic} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); voiceCall.toggleSpeaker() }}
            className={clsx(
              sz, 'flex items-center justify-center transition-colors',
              !session.isSpeakerOn ? 'bg-amber-500 hover:bg-amber-400' : 'bg-zinc-700 hover:bg-zinc-600'
            )}
          >
            {session.isSpeakerOn ? <IcoSpeaker size={ic} /> : <IcoSpeakerOff size={ic} />}
          </button>
        </>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); voiceCall.hangup() }}
        className={clsx(sz, 'bg-red-500 hover:bg-red-400 flex items-center justify-center transition-colors')}
      >
        <IcoPhoneOff size={ic} />
      </button>
    </div>
  )
}

// ── 图标 ────────────────────────────────────────────────────────────────────

const s = { fill: 'none', stroke: 'white', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function IcoPhone({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...s}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.22 1.18 2 2 0 012.18 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.18 6.18l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
}
function IcoPhoneOff({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...s}><path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67m-2.67-3.34a19.79 19.79 0 01-3.07-8.63A2 2 0 012.18 2h3a2 2 0 011.72 2 12.05 12.05 0 00.7 2.81 2 2 0 01-.45 2.11L6.91 10.1a16 16 0 002.6 3.41M23 1L1 23"/></svg>
}
function IcoMic({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...s}><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/></svg>
}
function IcoMicOff({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...s}><path d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"/><path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8"/></svg>
}
function IcoSpeaker({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...s}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
}
function IcoSpeakerOff({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" {...s}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
}
