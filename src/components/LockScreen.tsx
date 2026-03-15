export function LockScreen() {
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-white dark:bg-zinc-950 gap-4">
      <div className="w-12 h-12 rounded-2xl bg-zinc-900 dark:bg-white flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="5" y="11" width="14" height="10" rx="2" fill="white" className="dark:fill-zinc-900"/>
          <path d="M8 11V7a4 4 0 018 0v4" stroke="white" className="dark:stroke-zinc-900" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">SafeChat</p>
        <p className="text-xs text-zinc-400 mt-1">正在初始化加密...</p>
      </div>
      <div className="flex gap-1 mt-2">
        {[0,1,2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  )
}
