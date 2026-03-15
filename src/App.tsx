import { useEffect } from 'react'
import { useStore } from './store'
import { Onboarding } from './components/Onboarding'
import { ChatShell } from './components/ChatShell'
import { LockScreen } from './components/LockScreen'

export default function App() {
  const { initApp, isInitialized, isOnboarding } = useStore()

  useEffect(() => { initApp() }, [])

  if (!isInitialized) return <LockScreen />
  if (isOnboarding) return <Onboarding />
  return <ChatShell />
}
