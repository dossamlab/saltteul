import { ArrowLeft, Baby, Bell, CheckSquare, Home, House, Settings2, ShoppingBasket } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { togetherDays } from '../shared/anniversaries'
import { QuickCapture } from './components/QuickCapture'
import { UpdateBanner } from './components/UpdateBanner'
import { IconButton } from './components/ui'
import { t } from './copy'
import { useHousehold } from './data/store'
import { formatDay } from './format'
import { captureDone, openBus, type OpenTarget } from './native/open'
import { DesktopHome, HomeScreen, TabletHome, type Go } from './screens/Home'
import { InboxScreen } from './screens/Inbox'
import { KidsScreen } from './screens/Kids'
import { OurHomeScreen } from './screens/OurHome'
import { PackingBaseScreen } from './screens/PackingBase'
import { SettingsScreen } from './screens/Settings'
import { ShoppingScreen } from './screens/Shopping'
import { TodosScreen, writeTodoView, type TodoSection } from './screens/Todos'
import { TripScreen } from './screens/Trip'
import { useLayout } from './useLayout'

type Tab = 'home' | 'todos' | 'shopping' | 'kids' | 'ourhome'
/** Full screens over the tabs: settings, inbox, the base packing list and one trip's checklist (`trip:{id}`). */
type Overlay = 'settings' | 'inbox' | 'packing' | `trip:${string}` | null

const TABS: { id: Tab; icon: typeof Home; label: string }[] = [
  { id: 'home', icon: Home, label: 'tab.home' },
  { id: 'todos', icon: CheckSquare, label: 'tab.todos' },
  { id: 'shopping', icon: ShoppingBasket, label: 'tab.shopping' },
  { id: 'kids', icon: Baby, label: 'tab.kids' },
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
function Sidebar({ tab, overlay, go, open }: { tab: Tab; overlay: Overlay; go: (t: Tab) => void; open: (o: 'settings' | 'inbox') => void }) {
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
  // The base list opened from a trip goes back to that trip.
  const [backTo, setBackTo] = useState<Overlay>(null)
  const unread = h.nudges.filter((n) => !n.read).length
  const together = h.anniversaries.find((a) => a.kind === 'together')
  const pc = layout === 'pc'
  /** Quick add opened from a widget (n changes per open so a second tap starts afresh). */
  const [capture, setCapture] = useState<{ mic: boolean; n: number } | null>(null)
  /** Bumped when a widget opens the todo screen, so it starts again on today (and in the month view if asked). */
  const [todosKey, setTodosKey] = useState(0)

  useEffect(() => { document.title = t('app.name') }, [])

  // One place to type per screen: the todo and shopping tabs put the quick-add line on top of their list (saving the
  // line as it is when Claude cannot read it); the other phone tabs keep the round button.
  const fallback = tab === 'todos' ? 'todo' as const : tab === 'shopping' ? 'shopping' as const : undefined
  const inlineQuick = !overlay && !!fallback

  const go: Go = (next, sec) => {
    setOverlay(null)
    setBackTo(null)
    setTab(next)
    if (sec) setSection(sec)
    window.scrollTo({ top: 0 })
  }
  const openOverlay = (o: Exclude<Overlay, null>) => {
    setBackTo(o === 'packing' && overlay?.startsWith('trip:') ? overlay : null)
    setOverlay(o)
    window.scrollTo({ top: 0 })
  }
  const closeOverlay = useCallback(() => {
    setOverlay(backTo)
    setBackTo(null)
    window.scrollTo({ top: 0 })
  }, [backTo])
  const openTrip = (id: string) => openOverlay(`trip:${id}`)

  // A widget tap (window.saltteulOpen from the Android app), possibly made before this screen existed.
  const onOpen = useRef<(target: OpenTarget) => void>(() => {})
  onOpen.current = (target) => {
    if (target === 'capture' || target === 'capture-mic') {
      setCapture((c) => ({ mic: target === 'capture-mic', n: (c?.n ?? 0) + 1 }))
    } else if (target.startsWith('trip:')) {
      setBackTo(null)
      setOverlay(target as `trip:${string}`)
      window.scrollTo({ top: 0 })
    } else if (target === 'shopping') {
      go('shopping')
    } else {
      if (target === 'todos-month') writeTodoView('month')
      setTodosKey((k) => k + 1)
      go('todos', 'today')
    }
  }
  useEffect(() => openBus.subscribe((target) => onOpen.current(target)), [])
  const finishCapture = useCallback(() => {
    setCapture(null)
    captureDone()
  }, [])
  const launcher = capture && <QuickCapture key={capture.n} variant="launch" mic={capture.mic} onDone={finishCapture} />
  const tripId = overlay?.startsWith('trip:') ? overlay.slice(5) : null
  const overlayTitle = tripId ? h.trips.find((x) => x.id === tripId)?.name ?? '' : overlay ? t(`${overlay}.title`) : ''

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
  if (tripId) body = <TripScreen key={tripId} tripId={tripId} onClose={closeOverlay} openPacking={() => openOverlay('packing')} wide={layout !== 'phone'} />
  else if (overlay === 'packing') body = <PackingBaseScreen wide={layout !== 'phone'} />
  else if (overlay === 'settings') body = <SettingsScreen wide={pc} />
  else if (overlay === 'inbox') body = pc ? <div className="mx-auto max-w-[720px]"><InboxScreen /></div> : <InboxScreen />
  else {
    body =
      tab === 'home' ? (pc ? <DesktopHome go={go} openTrip={openTrip} /> : layout === 'tablet' ? <TabletHome go={go} openTrip={openTrip} /> : <HomeScreen go={go} openTrip={openTrip} />)
      : tab === 'todos' ? <TodosScreen key={todosKey} section={section} onSection={setSection} wide={pc} detailed={layout !== 'phone'} />
      : tab === 'shopping' ? <ShoppingScreen wide={pc} />
      : tab === 'kids' ? <KidsScreen wide={pc} />
      : <OurHomeScreen openSettings={() => openOverlay('settings')} openTrip={openTrip} openPacking={() => openOverlay('packing')} wide={pc} />
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
      : tripId || overlay === 'packing' ? 'max-w-[760px]'
      : overlay === 'settings' || tab === 'shopping' || tab === 'ourhome' ? 'max-w-[1200px]'
      : 'max-w-[1360px]'
    const pcTitle = overlay ? overlayTitle : tab === 'home' ? formatDay(h.today) : t(`tab.${tab}`)
    return (
      <div className="flex min-h-full">
        <Sidebar tab={tab} overlay={overlay} go={(id) => go(id)} open={openOverlay} />
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 bg-canvas/85 backdrop-blur-xl">
            <div className={`mx-auto flex h-20 items-center gap-6 px-8 ${maxW} box-content`}>
              {(tripId || overlay === 'packing') && (
                <IconButton label={t('action.back')} onClick={closeOverlay} className="-mr-4"><ArrowLeft size={22} /></IconButton>
              )}
              <h1 className="min-w-0 flex-1 truncate text-[24px] font-bold tracking-tight text-ink">{pcTitle}</h1>
              {!overlay && <div className="w-[min(480px,45%)] shrink-0"><QuickCapture variant="bar" fallback={fallback} /></div>}
            </div>
          </header>
          <main className="px-8 pb-12 pt-1">{body}</main>
        </div>
        {launcher}
      </div>
    )
  }

  const header = overlay
    ? <Header title={<span className="block truncate text-[20px] font-bold tracking-tight">{overlayTitle}</span>} onBack={closeOverlay} />
    : (
      <Header
        title={tab === 'home' ? homeTitle : <span className="text-[20px] font-bold tracking-tight">{t(`tab.${tab}`)}</span>}
        right={layout === 'tablet'
          ? <div className="flex items-center gap-3"><div className="w-[340px]"><QuickCapture variant="bar" fallback={fallback} /></div>{actions}</div>
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
        {launcher}
      </div>
    )
  }

  return (
    <div className="min-h-full">
      {header}
      <main className="mx-auto max-w-xl px-5 pb-36">
        <UpdateBanner />
        {inlineQuick && <div className="mb-4"><QuickCapture variant="bar" fallback={fallback} /></div>}
        {body}
      </main>
      {!overlay && !inlineQuick && <QuickCapture variant="fab" />}
      {launcher}
      {!overlay && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 backdrop-blur-xl">
          <div className="mx-auto grid h-16 max-w-xl grid-cols-5">
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
