import { collection, doc, limit, onSnapshot, orderBy, query, where, type Query } from 'firebase/firestore'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { addDays, householdDate } from '../../shared/householdDate'
import type {
  Anniversary, Briefing, Chore, Consumable, DinnerSuggestion, IntegrationState, JournalEntry, Member, Nudge, Owner, PantryItem,
  PrepRule, Routine, RoutineLog, Settings, ShoppingItem, Todo, Ymd,
} from '../../shared/types'
import { useReadySession } from '../auth/session'
import { t } from '../copy'
import { db } from '../firebase'

export interface HouseholdData {
  loaded: boolean
  hid: string
  uid: string
  today: Ymd
  members: Member[]
  todos: Todo[]
  shopping: ShoppingItem[]
  routines: Routine[]
  routineLogs: RoutineLog[]
  chores: Chore[]
  anniversaries: Anniversary[]
  consumables: Consumable[]
  /** Things the house should always have (상비품). */
  pantry: PantryItem[]
  prepRules: PrepRule[]
  briefings: Briefing[]
  nudges: Nudge[]
  integrations: IntegrationState[]
  /** Weekly growth journal, newest week first (up to 12). */
  journal: JournalEntry[]
  /** Today's dinner suggestions (doc id = household date), null until the server writes it. */
  dinner: DinnerSuggestion | null
  settings: Settings
  nameOf: (uidOrOwner: string | Owner) => string
  me: Member | undefined
  partner: Member | undefined
}

const EMPTY_SETTINGS: Settings = { familyName: '', briefingTimes: { morning: '07:30', evening: '20:00' } }
const Ctx = createContext<HouseholdData | null>(null)

export function useHousehold() {
  const v = useContext(Ctx)
  if (!v) throw new Error('HouseholdProvider missing')
  return v
}

/** Re-evaluates the household day every minute so routines reset at 04:00 without a reload. */
function useHouseholdToday(): Ymd {
  const [today, setToday] = useState(() => householdDate(new Date()))
  useEffect(() => {
    const id = setInterval(() => setToday(householdDate(new Date())), 60_000)
    return () => clearInterval(id)
  }, [])
  return today
}

function useList<T>(q: Query | null, deps: unknown[]): [T[], boolean] {
  const [state, setState] = useState<{ items: T[]; ready: boolean }>({ items: [], ready: false })
  useEffect(() => {
    if (!q) return
    return onSnapshot(q, (snap) => setState({ items: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T), ready: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return [state.items, state.ready]
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { hid, user } = useReadySession()
  const today = useHouseholdToday()
  const base = `households/${hid}`
  const c = (name: string) => collection(db, `${base}/${name}`)

  const [members, l1] = useList<Member>(c('members'), [hid])
  const [todos, l2] = useList<Todo>(c('todos'), [hid])
  const [shopping, l3] = useList<ShoppingItem>(c('shopping'), [hid])
  const [routines] = useList<Routine>(c('routines'), [hid])
  const [routineLogs] = useList<RoutineLog>(query(c('routineLogs'), where('day', '>=', addDays(today, -1))), [hid, today])
  const [chores] = useList<Chore>(c('chores'), [hid])
  const [anniversaries] = useList<Anniversary>(c('anniversaries'), [hid])
  const [consumables] = useList<Consumable>(c('consumables'), [hid])
  const [pantry] = useList<PantryItem>(c('pantry'), [hid])
  const [prepRules] = useList<PrepRule>(c('prepRules'), [hid])
  const [briefings, l4] = useList<Briefing>(query(c('briefings'), orderBy('createdAt', 'desc'), limit(4)), [hid])
  const [nudges] = useList<Nudge>(query(c('nudges'), where('to', '==', user.uid), orderBy('createdAt', 'desc'), limit(30)), [hid])
  const [integrations] = useList<IntegrationState>(c('integrations'), [hid])
  const [journal] = useList<JournalEntry>(query(c('journal'), orderBy('weekStart', 'desc'), limit(12)), [hid])
  const [dinner, setDinner] = useState<DinnerSuggestion | null>(null)
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS)
  const [l5, setL5] = useState(false)

  useEffect(
    () => onSnapshot(doc(db, `${base}/settings/main`), (d) => {
      setSettings({ ...EMPTY_SETTINGS, ...(d.data() as Settings) })
      setL5(true)
    }),
    [base],
  )

  useEffect(
    () => onSnapshot(doc(db, `${base}/dinner/${today}`), (d) => {
      setDinner(d.exists() ? ({ id: d.id, ...d.data() } as DinnerSuggestion) : null)
    }, () => setDinner(null)),
    [base, today],
  )

  const value = useMemo<HouseholdData>(() => {
    const me = members.find((m) => m.uid === user.uid)
    const partner = members.find((m) => m.uid !== user.uid)
    const byRole = (r: 'husband' | 'wife') => members.find((m) => m.role === r)
    const nameOf = (key: string) => {
      if (key === 'both') return t('owner.both')
      if (key === 'husband' || key === 'wife') return byRole(key)?.displayName || t(`owner.${key}`)
      return members.find((m) => m.uid === key)?.displayName || t('owner.unknown')
    }
    return {
      loaded: l1 && l2 && l3 && l4 && l5,
      hid, uid: user.uid, today, members, todos, shopping, routines, routineLogs, chores, anniversaries, consumables,
      pantry, prepRules, briefings, nudges, integrations, journal, dinner, settings, nameOf, me, partner,
    }
  }, [hid, user.uid, today, members, todos, shopping, routines, routineLogs, chores, anniversaries, consumables, pantry, prepRules,
    briefings, nudges, integrations, journal, dinner, settings, l1, l2, l3, l4, l5])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
