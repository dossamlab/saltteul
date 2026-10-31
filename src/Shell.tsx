import { ArrowLeft, Bell, CheckSquare, Home, House, Settings2, ShoppingBasket } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { togetherDays } from '../shared/anniversaries'
import { QuickCapture } from './components/QuickCapture'
import { UpdateBanner } from './components/UpdateBanner'
import { IconButton } from './components/ui'
import { t } from './copy'
import { useHousehold } from './data/store'
import { formatDay } from './format'
import { DesktopHome, HomeScreen, TabletHome, type Go } from './screens/Home'
import { InboxScreen } from './screens/Inbox'
import { OurHomeScreen } from './screens/OurHome'
import { SettingsScreen } from './screens/Settings'
import { ShoppingScreen } from './screens/Shopping'
import { TodosScreen, type TodoSection } from './screens/Todos'
import { useLayout } from './useLayout'

type Tab = 'home' | 'todos' | 'shopping' | 'ourhome'
type Overlay = 'settings' | 'inbox' | null

const TABS: { id: Tab; icon: typeof Home; label: string }[] = [
  { id: 'home', icon: Home, label: 'tab.home' },
  { id: 'todos', icon: CheckSquare, label: 'tab.todos' },
  { id: 'shopping', icon: ShoppingBasket, label: 'tab.shopping' },
  { id: 'ourhome', icon: House, label: 'tab.ourhome' },
]

function Header({ title, onBack, right }: { title: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="pt-safe sticky top-0 z-30 bg-canvas/85 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-2 px-5">
        {onBack && <IconButton label={t('action.back')} onClick={onBack} className="-ml-2"><ArrowLeft size={20} /></IconButton>}
        <div className="min-w-0 flex-1">{title}</div>
        {right}
      </div>
    </header>
  )
}

function UnreadBadge({ n, className = '' }: { n: number; className?: string }) {
  if (n <= 0) return null
  return <span className={`grid h-5 min-w-5 place-items-center rounded-full bg-terra px-1.5 text-[11px] font-bold text-white ${className}`}>{n}</span>
}

/** PC (>= 1200px) left sidebar: identity on top, tabs with labels, inbox/settings/member at the bottom. */
function Sidebar({ tab, overlay, go, open }: { tab: Tab; overlay: Overlay; go: (t: Tab) => void; open: (o: Exclude<Overlay, null>) => void }) {
  const h = useHousehold()
  const unread = h.nudges.filter((n) => !n.read).length
  const item = (active: boolean) =>
    `flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-semibold transition-colors ${
      active ? 'bg-sage-soft text-sage' : 'text-ink-2 hover:bg-muted hover:text-ink'}`
  const name = h.me?.displayName || h.nameOf(h.uid)
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-card px-4 pb-5 pt-6">
      <div className="flex items-center gap-3 px-2">
        <img src="/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-[14px] shadow-[var(--shadow-card)]" />
        <div className="min-w-0">
          <p className="text-[19px] font-bold leading-tight tracking-tight text-sage">{t('app.name')}</p>
          <p className="truncate text-[13px] text-ink-2">{h.settings.familyName || t('app.defaultFamily')}</p>
        </div>
      </div>

      <nav className="mt-8 flex flex-col gap-1">
        {TABS.map(({ id, icon: Icon, label }) => {
          const active = tab === id && !overlay
          return (
            <button key={id} type="button" onClick={() => go(id)} aria-current={active ? 'page' : undefined} className={item(active)}>
              <Icon size={20} strokeWidth={active ? 2.4 : 2} />
              {t(label)}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-line pt-4">
        <button type="button" onClick={() => open('inbox')} aria-current={overlay === 'inbox' ? 'page' : undefined} className={item(overlay === 'inbox')}>
          <Bell size={20} />
          <span className="flex-1">{t('inbox.title')}</span>
          <UnreadBadge n={unread} />
        </button>
        <button type="button" onClick={() => open('settings')} aria-current={overlay === 'settings' ? 'page' : undefined} className={item(overlay === 'settings')}>
          <Settings2 size={20} />
          {t('settings.title')}
        </button>
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-muted px-3 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sage text-[14px] font-bold text-white">{name.slice(0, 1)}</span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-ink">{name}</p>
            <p className="truncate text-[12px] text-ink-2">{h.me?.email}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

export function Shell() {
  const h = useHousehold()
  const layout = useLayout()
  const [tab, setTab] = useState<Tab>('home')
  const [section, setSection] = useState<TodoSection>('today')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const unread = h.nudges.filter((n) => !n.read).length
  const together = h.anniversaries.find((a) => a.kind === 'together')
  const pc = layout === 'pc'

  useEffect(() => { document.title = t('app.name') }, [])

  const go: Go = (next, sec) => {
    setOverlay(null)
    setTab(next)
    if (sec) setSection(sec)
    window.scrollTo({ top: 0 })
  }
  const openOverlay = (o: Exclude<Overlay, null>) => {
    setOverlay(o)
    window.scrollTo({ top: 0 })
  }

  const homeTitle = (
    <div className="flex flex-col">
      <span className="truncate text-[20px] font-bold tracking-tight text-sage">{h.settings.familyName || t('app.defaultFamily')}</span>
      <span className="text-[12px] text-ink-2">
        {formatDay(h.today)}
        {together && ` · ${t('home.togetherDays', { n: togetherDays(together.date, h.today) })}`}
      </span>
    </div>
  )
  const actions = (
    <div className="flex items-center">
      <IconButton label={t('inbox.title')} onClick={() => setOverlay('inbox')} className="relative">
        <Bell size={20} />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-terra px-1 text-[10px] font-bold text-white">{unread}</span>}
      </IconButton>
      <IconButton label={t('settings.title')} onClick={() => setOverlay('settings')}><Settings2 size={20} /></IconButton>
    </div>
  )

  let body: ReactNode
  if (overlay === 'settings') body = <SettingsScreen wide={pc} />
  else if (overlay === 'inbox') body = pc ? <div className="mx-auto max-w-[720px]"><InboxScreen /></div> : <InboxScreen />
  else {
    body =
      tab === 'home' ? (pc ? <DesktopHome go={go} /> : layout === 'tablet' ? <TabletHome go={go} /> : <HomeScreen go={go} />)
      : tab === 'todos' ? <TodosScreen section={section} onSection={setSection} wide={pc} />
      : tab === 'shopping' ? <ShoppingScreen wide={pc} />
      : <OurHomeScreen openSettings={() => setOverlay('settings')} wide={pc} />
  }

  if (!h.loaded) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3">
        <img src="/icon-192.png" alt="" className="h-16 w-16 animate-pulse rounded-[24px]" />
        <p className="text-[13px] text-ink-2">{t('widget.loading')}</p>
      </div>
    )
  }

  if (pc) {
    const maxW = overlay === 'inbox' ? 'max-w-[720px]'
      : overlay === 'settings' || tab === 'shopping' || tab === 'ourhome' ? 'max-w-[1200px]'
      : 'max-w-[1360px]'
    const pcTitle = overlay ? t(`${overlay}.title`) : tab === 'home' ? formatDay(h.today) : t(`tab.${tab}`)
    return (
      <div className="flex min-h-full">
        <Sidebar tab={tab} overlay={overlay} go={(id) => go(id)} open={openOverlay} />
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 bg-canvas/85 backdrop-blur-xl">
            <div className={`mx-auto flex h-20 items-center gap-6 px-8 ${maxW} box-content`}>
              <h1 className="min-w-0 flex-1 truncate text-[24px] font-bold tracking-tight text-ink">{pcTitle}</h1>
              {!overlay && <div className="w-[min(480px,45%)] shrink-0"><QuickCapture variant="bar" /></div>}
            </div>
          </header>
          <main className="px-8 pb-12 pt-1">{body}</main>
        </div>
      </div>
    )
  }

  const header = overlay
    ? <Header title={<span className="text-[20px] font-bold tracking-tight">{t(`${overlay}.title`)}</span>} onBack={() => setOverlay(null)} />
    : (
      <Header
        title={tab === 'home' ? homeTitle : <span className="text-[20px] font-bold tracking-tight">{t(`tab.${tab}`)}</span>}
        right={layout === 'tablet'
          ? <div className="flex items-center gap-3"><div className="w-[340px]"><QuickCapture variant="bar" /></div>{actions}</div>
          : actions}
      />
    )

  if (layout === 'tablet') {
    return (
      <div className="flex min-h-full">
        <nav className="pt-safe sticky top-0 flex h-screen w-24 shrink-0 flex-col items-center gap-2 border-r border-line bg-card py-6">
          {TABS.map(({ id, icon: Icon, label }) => {
            const active = tab === id && !overlay
            return (
              <button key={id} type="button" onClick={() => go(id)}
                className={`flex w-20 flex-col items-center gap-1 rounded-2xl py-3 text-[12px] font-semibold ${active ? 'bg-sage-soft text-sage' : 'text-ink-2'}`}>
                <Icon size={22} />
                {t(label)}
              </button>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1">
          {header}
          <main className="mx-auto max-w-[1400px] px-6 pb-10"><UpdateBanner />{body}</main>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full">
      {header}
      <main className="mx-auto max-w-xl px-5 pb-36"><UpdateBanner />{body}</main>
      {!overlay && <QuickCapture variant="fab" />}
      {!overlay && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur-xl">
          <div className="mx-auto grid h-16 max-w-xl grid-cols-4">
            {TABS.map(({ id, icon: Icon, label }) => (
              <button key={id} type="button" onClick={() => go(id)}
                className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${tab === id ? 'text-sage' : 'text-ink-3'}`}>
                <Icon size={22} strokeWidth={tab === id ? 2.4 : 2} />
                {t(label)}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}
