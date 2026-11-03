import { Baby, ChevronRight, ShoppingBasket } from 'lucide-react'
import { useState } from 'react'
import { choreStatus } from '../../shared/chores'
import { isRoutineDone, routinesForDay } from '../../shared/routines'
import type { Todo } from '../../shared/types'
import { AnniversaryCard, AnniversaryStrip, BriefingCard, DinnerCard, KidsnoteCard, WeatherCard } from '../components/HomeCards'
import { ChoreList, RoutineChecklist } from '../components/RoutineParts'
import { NudgeSheet, TodoRow, TodoSheet } from '../components/TodoParts'
import { Card, CardHeader, Checkbox, Empty } from '../components/ui'
import { t } from '../copy'
import { toggleShopping } from '../data/actions'
import { useHousehold } from '../data/store'
import { ShoppingList, ShoppingSuggestions } from './Shopping'
import { sortTodos, type TodoSection } from './Todos'

export type Go = (tab: 'home' | 'todos' | 'shopping' | 'kids' | 'ourhome', section?: TodoSection) => void

function MoreLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center text-[13px] font-semibold text-sage">
      {t('action.seeAll')}
      <ChevronRight size={16} />
    </button>
  )
}

function TodayCard({ go, limit, className }: { go: Go; limit?: number; className?: string }) {
  const h = useHousehold()
  const [editing, setEditing] = useState<Todo | null>(null)
  const [nudge, setNudge] = useState<Todo | null>(null)
  const list = sortTodos(h.todos.filter((x) => x.date === h.today))
  const shown = limit ? list.filter((x) => !x.done).slice(0, limit) : list
  const left = list.filter((x) => !x.done).length
  return (
    <Card className={className}>
      <CardHeader title={t('home.todayTitle')} action={<MoreLink onClick={() => go('todos', 'today')} />} />
      <p className="-mt-2 mb-1 text-[12px] text-ink-2">{t('todo.countLeft', { n: left })}</p>
      {shown.length === 0 && <Empty>{left === 0 && list.length ? t('home.todayAllDone') : t('todo.emptyDay')}</Empty>}
      <div className="divide-y divide-line">
        {shown.map((x) => <TodoRow key={x.id} todo={x} onEdit={setEditing} onNudge={setNudge} />)}
      </div>
      <TodoSheet open={!!editing} onClose={() => setEditing(null)} todo={editing} />
      <NudgeSheet target={nudge && { type: 'todo', id: nudge.id, title: nudge.title }} onClose={() => setNudge(null)} />
    </Card>
  )
}

function RoutineSummaryCard({ go, full, className }: { go: Go; full?: boolean; className?: string }) {
  const h = useHousehold()
  const list = routinesForDay(h.routines, h.today)
  const left = list.filter((r) => !isRoutineDone(h.routineLogs, r.id, h.today)).length
  return (
    <Card className={className}>
      <CardHeader title={t('routine.title')} action={<MoreLink onClick={() => go('todos', 'routines')} />} />
      <p className="-mt-2 mb-1 text-[12px] text-ink-2">{t('routine.progress', { done: list.length - left, total: list.length })}</p>
      <RoutineChecklist compact={!full} />
    </Card>
  )
}

function ChoreSummaryCard({ go, full, className }: { go: Go; full?: boolean; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader title={t('chore.dueTitle')} action={<MoreLink onClick={() => go('todos', 'chores')} />} />
      <ChoreList compact={!full} />
    </Card>
  )
}

function ShoppingSummaryCard({ go }: { go: Go }) {
  const h = useHousehold()
  const open = h.shopping.filter((s) => !s.bought)
  return (
    <Card>
      <CardHeader title={t('shop.listTitle')} icon={<ShoppingBasket size={18} className="text-terra" />} action={<MoreLink onClick={() => go('shopping')} />} />
      {open.length === 0 ? <Empty>{t('shop.empty')}</Empty> : (
        <p className="text-[15px]">
          <span className="font-semibold text-terra-2">{t('shop.countLeft', { n: open.length })}</span>
          <span className="ml-2 text-ink-2">{open.slice(0, 4).map((s) => s.name).join(', ')}</span>
        </p>
      )}
    </Card>
  )
}

/** PC home: the open shopping items as a short checklist with the one-item add box. */
function ShoppingHomeCard({ go, className }: { go: Go; className?: string }) {
  const h = useHousehold()
  const open = h.shopping.filter((s) => !s.bought).sort((a, b) => b.createdAt - a.createdAt)
  const shown = open.slice(0, 5)
  return (
    <Card className={`flex flex-col ${className ?? ''}`}>
      <CardHeader title={t('shop.listTitle')} icon={<ShoppingBasket size={18} className="text-terra" />} action={<MoreLink onClick={() => go('shopping')} />} />
      <p className="-mt-2 mb-1 text-[12px] text-ink-2">{t('shop.countLeft', { n: open.length })}</p>
      {open.length === 0 && <Empty>{t('shop.empty')}</Empty>}
      <div className="divide-y divide-line">
        {shown.map((s) => (
          <div key={s.id} className="flex items-center gap-3 py-2.5">
            <Checkbox checked={s.bought} label={s.name} onChange={() => toggleShopping(h.hid, s, h.uid, h.today, h.consumables, h.pantry)} />
            <p className="min-w-0 flex-1 truncate text-[15px]">
              {s.name}
              {s.qty && <span className="ml-1.5 text-[13px] text-ink-2">{s.qty}</span>}
            </p>
          </div>
        ))}
      </div>
      {open.length > shown.length && (
        <p className="pt-1 text-[12px] text-ink-2">{t('shop.moreItems', { n: open.length - shown.length })}</p>
      )}
    </Card>
  )
}

function GroupLabel({ title, onMore, first }: { title: string; onMore: () => void; first: boolean }) {
  return (
    <div className={`flex items-center justify-between ${first ? '' : 'mt-3 border-t border-line pt-3'}`}>
      <p className="text-[13px] font-semibold text-ink-2">{title}</p>
      <MoreLink onClick={onMore} />
    </div>
  )
}

/** Phone home: today's open todos, routines not done yet and chores due, in one card. Finished ones show as counts. */
function TodayAllCard({ go }: { go: Go }) {
  const h = useHousehold()
  const [editing, setEditing] = useState<Todo | null>(null)
  const [nudge, setNudge] = useState<Todo | null>(null)
  const todos = h.todos.filter((x) => x.date === h.today)
  const openTodos = sortTodos(todos.filter((x) => !x.done)).slice(0, 4)
  const routines = routinesForDay(h.routines, h.today)
  const routinesDone = routines.filter((r) => isRoutineDone(h.routineLogs, r.id, h.today)).length
  const choresDue = h.chores.filter((c) => choreStatus(c, h.today).kind !== 'left').length
  const progress = [
    t('home.todoProgress', { done: todos.length - todos.filter((x) => !x.done).length, total: todos.length }),
    routines.length ? t('home.routineProgress', { done: routinesDone, total: routines.length }) : '',
  ].filter(Boolean).join(' · ')
  const routinesLeft = routinesDone < routines.length
  const nothingLeft = !openTodos.length && !routinesLeft && !choresDue
  return (
    <Card>
      <CardHeader title={t('home.todayCardTitle')} action={<span className="text-[12px] text-ink-2">{progress}</span>} />
      {nothingLeft && <Empty>{todos.length ? t('home.todayAllDone') : t('todo.emptyDay')}</Empty>}
      {openTodos.length > 0 && (
        <>
          <GroupLabel first title={t('todos.tab.today')} onMore={() => go('todos', 'today')} />
          <div className="divide-y divide-line">
            {openTodos.map((x) => <TodoRow key={x.id} todo={x} onEdit={setEditing} onNudge={setNudge} />)}
          </div>
        </>
      )}
      {routinesLeft && (
        <>
          <GroupLabel first={!openTodos.length} title={t('todos.tab.routines')} onMore={() => go('todos', 'routines')} />
          <RoutineChecklist compact />
        </>
      )}
      {choresDue > 0 && (
        <>
          <GroupLabel first={!openTodos.length && !routinesLeft} title={t('todos.tab.chores')} onMore={() => go('todos', 'chores')} />
          <ChoreList compact />
        </>
      )}
      <TodoSheet open={!!editing} onClose={() => setEditing(null)} todo={editing} />
      <NudgeSheet target={nudge && { type: 'todo', id: nudge.id, title: nudge.title }} onClose={() => setNudge(null)} />
    </Card>
  )
}

/** Phone home: one line about the child (upcoming Kids Note events, today's lunch) that opens the child tab. */
function KidsLine({ go }: { go: Go }) {
  const h = useHousehold()
  const events = h.todos.filter((x) => x.source === 'kidsnote' && x.date && x.date >= h.today && !x.done).length
  const lunch = h.todayMenu?.lunch?.join(', ')
  return (
    <button type="button" onClick={() => go('kids')}
      className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-card px-5 py-4 text-left shadow-[var(--shadow-card)]">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-lavender/60 text-wisteria"><Baby size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{events ? t('home.kidsEvents', { n: events }) : t('home.kidsNoEvents')}</span>
        {lunch && <span className="block truncate text-[13px] text-ink-2">{t('home.kidsLunch', { menu: lunch })}</span>}
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-3" />
    </button>
  )
}

export function HomeScreen({ go }: { go: Go }) {
  return (
    <div className="flex flex-col gap-4">
      <AnniversaryStrip />
      <BriefingCard />
      <WeatherCard collapsible />
      <TodayAllCard go={go} />
      <ShoppingSummaryCard go={go} />
      <KidsLine go={go} />
    </div>
  )
}

/** Tablet: everything on one screen in columns (3 in landscape, 2 in portrait). */
export function TabletHome({ go }: { go: Go }) {
  return (
    <div className="flex flex-col gap-4">
      <AnniversaryStrip />
      <div className="grid grid-cols-2 items-start gap-4 xl:grid-cols-3 [@media(orientation:landscape)]:grid-cols-3">
        <div className="flex flex-col gap-4">
          <BriefingCard />
          <WeatherCard />
        </div>
        <div className="flex flex-col gap-4">
          <TodayCard go={go} />
          <RoutineSummaryCard go={go} full />
          <ChoreSummaryCard go={go} />
        </div>
        <div className="flex flex-col gap-4">
          <ShoppingSuggestions />
          <ShoppingList />
          <KidsnoteCard />
          <DinnerCard />
        </div>
      </div>
    </div>
  )
}

/** PC (>= 1200px): 12-column grid, three rows of equal-height cards. */
export function DesktopHome({ go }: { go: Go }) {
  return (
    <div className="mx-auto grid max-w-[1360px] grid-cols-12 gap-5">
      <BriefingCard large className="col-span-8 h-full" />
      <div className="col-span-4 flex flex-col gap-5">
        <WeatherCard />
        <AnniversaryCard className="flex-1" />
      </div>

      <TodayCard go={go} limit={5} className="col-span-4 h-full" />
      <RoutineSummaryCard go={go} className="col-span-4 h-full" />
      <ChoreSummaryCard go={go} className="col-span-4 h-full" />

      <ShoppingHomeCard go={go} className="col-span-4 h-full" />
      <KidsnoteCard className="col-span-4 h-full" />
      <DinnerCard className="col-span-4 h-full" />
    </div>
  )
}
