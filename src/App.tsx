import { LogIn } from 'lucide-react'
import { logOut, signIn, useSession } from './auth/session'
import { Button } from './components/ui'
import { t } from './copy'
import { HouseholdProvider } from './data/store'
import { Shell } from './Shell'

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full flex-col items-center justify-center gap-5 px-8 text-center">{children}</div>
}

function Logo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <img src="/icon-192.png" alt="" className="h-20 w-20 rounded-[28px] shadow-[var(--shadow-card)]" />
      <h1 className="text-[28px] font-bold tracking-tight text-sage">{t('app.name')}</h1>
      <p className="text-[14px] text-ink-2">{t('app.tagline')}</p>
    </div>
  )
}

export default function App() {
  const s = useSession()
  if (s.status === 'loading') return <Centered><Logo /></Centered>
  if (s.status === 'signedOut') {
    return (
      <Centered>
        <Logo />
        <Button onClick={() => signIn()} className="w-full max-w-xs"><LogIn size={18} />{t('auth.signIn')}</Button>
      </Centered>
    )
  }
  if (s.status === 'notAllowed' || s.status === 'error') {
    return (
      <Centered>
        <Logo />
        <p className="text-[15px] text-ink">
          {s.status === 'notAllowed' ? t('auth.notAllowed', { email: s.email }) : t('auth.error')}
        </p>
        <Button variant="soft" onClick={() => logOut()}>{t('auth.switchAccount')}</Button>
      </Centered>
    )
  }
  return (
    <HouseholdProvider>
      <Shell />
    </HouseholdProvider>
  )
}
