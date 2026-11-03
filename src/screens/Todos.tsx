import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { addDays, weekdayOf } from '../../shared/householdDate'
import { addMonths, isMonthPlan, monthGrid, monthNumber, monthOf, weekStart, type Ym } from '../../shared/monthPlan'
import { isRoutineDone, routinesForDay } from '../../shared/routines'
import type { Todo, Ymd } from '../../shared/types'
import { MonthPlanCard } from '../components/MonthPlan'
import { ChoreList, RoutineChecklist } from '../components/RoutineParts'
import { AddButton, NudgeSheet, sortTodos, TodoRow, TodoSheet } from '../components/TodoParts'
import { Card, CardHeader, Empty, IconButton, Segmented } from '../components/ui'
import { t } from '../copy'
import { useHousehold } from '../data/store'
import { formatDay, weekdayShort } from '../format'

export type TodoSection = 'today' | 'routines' | 'chores'
export type TodoView = 'week' | 'month'

export { sortTodos }

// The last chosen view is a per-phone convenience; storage may be unavailable, then the week view is used.
const VIEW_KEY = 'saltteul.todoView'
export function readTodoView(): TodoView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'month' ? 'month' : 'week'
  } catch {
    return 'week'
  }
}
export function writeTodoView(v: TodoView) {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch { /* not remembered */ }
}

const md = (d: Ymd) => t('date.mdShort', { m: Number(d.slice(5, 7)), d: Number(d.slice(8)) })
/** "11월 2일 ~ 8일", or "11월 30일 ~ 12월 6일" across two months. */
const weekLabel = (monday: Ymd) => {
  const sunday = addDays(monday, 6)
  return t('todo.weekRange', { from: md(monday), to: monthOf(sunday) === monthOf(monday) ? t('date.dShort', { d: Number(sunday.slice(8)) }) : md(sunday) })
}

function NavRow({ label, onPrev, onNext, prevLabel, nextLabel, view, onView, showToday, onToday }: {
  label: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string
  view: TodoView; onView: (v: TodoView) => void; showToday: boolean; onToday: () => void
}) {
  return (
    <div className="mb-3 flex items-center gap-1">
      <IconButton label={prevLabel} onClick={onPrev} className="h-9 w-9 bg-muted"><ChevronLeft size={18} /></IconButton>
      <p className="min-w-0 flex-1 truncate text-center text-[15px] font-bold text-ink">{label}</p>
      <IconButton label={nextLabel} onClick={onNext} className="h-9 w-9 bg-muted"><ChevronRight size={18} /></IconButton>
      {showToday && (
        <button type="button" onClick={onToday} className="ml-1 h-8 shrink-0 rounded-full bg-sage-soft px-3 text-[12px] font-bold text-sage">
          {t('date.today')}
        </button>
      )}
      <div className="ml-1 w-[96px] shrink-0">
        <Segmented value={view} onChange={onView} options={[{ value: 'week', label: t('todo.viewWeek') }, { value: 'month', label: t('todo.viewMonth') }]} />
      </div>
    </div>
  )
}

function WeekStrip({ selected, onSelect }: { selected: Ymd; onSelect: (d: Ymd) => void }) {
  const h = useHousehold()
  const monday = weekStart(selected)
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((d) => {
        const open = h.todos.filter((x) => x.date === d && !x.done).length
        const active = d === selected
        return (
          <button key={d} type="button" onClick={() => onSelect(d)} aria-pressed={active}
            className={`flex flex-col items-center gap-0.5 rounded-2xl py-2 ${active ? 'bg-sage text-white' : d === h.today ? 'bg-sage-soft text-sage' : 'text-ink-2'}`}>
            <span className="text-[11px] font-semibold">{weekdayShort(weekdayOf(d))}</span>
            <span className="text-[16px] font-semibold">{Number(d.slice(8))}</span>
            <span className={`h-1.5 w-1.5 rounded-full ${open ? (active ? 'bg-white' : 'bg-terra') : 'bg-transparent'}`} />
          </button>
        )
      })}
    </div>
  )
}

const WEEK_HEAD = [1, 2, 3, 4, 5, 6, 0]
const dayTone = (d: Ymd) => (weekdayOf(d) === 0 ? 'text-terra' : weekdayOf(d) === 6 ? 'text-[#5a7fb0]' : 'text-ink')
const dotTone = (x: Todo) => (x.done ? 'bg-ink-3' : x.source === 'calendar' ? 'bg-wisteria' : 'bg-terra')
const chipTone = (x: Todo) => (x.done ? 'bg-muted text-ink-3 line-through' : x.source === 'calendar' ? 'bg-lavender/40 text-wisteria' : 'bg-peach-soft text-terra-2')

/** Monday-first month. Phone: dots per todo (open, from Google Calendar, done); tablet and PC: up to three titles. */
function MonthGrid({ ym, selected, onSelect, detailed }: { ym: Ym; selected: Ymd; onSelect: (d: Ymd) => void; detailed: boolean }) {
  const h = useHousehold()
  const byDay = new Map<Ymd, Todo[]>()
  for (const x of h.todos) if (x.date) byDay.set(x.date, [...(byDay.get(x.date) ?? []), x])
  return (
    <div>
      <div className="grid grid-cols-7 pb-1.5">
        {WEEK_HEAD.map((wd) => (
          <span key={wd} className={`text-center text-[11px] font-semibold ${wd === 0 ? 'text-terra' : wd === 6 ? 'text-[#5a7fb0]' : 'text-ink-3'}`}>{weekdayShort(wd)}</span>
        ))}
      </div>
      <div className={`grid grid-cols-[repeat(7,minmax(0,1fr))] ${detailed ? 'border-l border-t border-line' : 'gap-0.5'}`}>
        {monthGrid(ym).map((d) => {
          const list = sortTodos(byDay.get(d) ?? [])
          const out = monthOf(d) !== ym
          const active = d === selected
          const label = `${formatDay(d)} ${t('todo.countLeft', { n: list.filter((x) => !x.done).length })}`
          if (detailed) {
            return (
              <button key={d} type="button" onClick={() => onSelect(d)} aria-label={label} aria-pressed={active}
                className={`flex h-[104px] min-w-0 flex-col gap-0.5 border-b border-r border-line p-1.5 text-left ${active ? 'bg-sage-soft' : ''}`}>
                <span className={`grid h-6 w-6 place-items-center rounded-full text-[13px] font-semibold ${d === h.today ? 'bg-sage text-white' : out ? 'text-ink-3' : dayTone(d)}`}>
                  {Number(d.slice(8))}
                </span>
                {list.slice(0, 3).map((x) => (
                  <span key={x.id} className={`truncate rounded-md px-1.5 py-px text-[11px] leading-snug ${chipTone(x)}`}>
                    {x.time ? `${x.time} ` : ''}{x.title}
                  </span>
                ))}
                {list.length > 3 && <span className="pl-1 text-[10px] font-bold text-ink-2">{t('todo.moreInDay', { n: list.length - 3 })}</span>}
              </button>
            )
          }
          return (
            <button key={d} type="button" onClick={() => onSelect(d)} aria-label={label} aria-pressed={active}
              className={`flex h-[52px] min-w-0 flex-col items-center gap-1 rounded-xl pt-1.5 ${active ? 'bg-sage' : ''}`}>
              <span className={`grid h-[22px] w-[26px] place-items-center rounded-full text-[14px] font-semibold ${
                active ? 'text-white' : d === h.today ? 'bg-sage-soft text-sage' : out ? 'text-ink-3' : dayTone(d)}`}>
                {Number(d.slice(8))}
              </span>
              <span className="flex h-1.5 items-center gap-[3px]">
                {list.slice(0, 3).map((x) => <i key={x.id} className={`block h-[5px] w-[5px] rounded-full ${active ? 'bg-white' : dotTone(x)}`} />)}
                {list.length > 3 && <em className={`text-[9px] font-bold not-italic ${active ? 'text-white' : 'text-terra-2'}`}>+{list.length - 3}</em>}
              </span>
            </button>
          )
        })}
      </div>
      {!detailed && (
        <div className="mt-2 flex gap-3 text-[12px] text-ink-2">
          <span className="flex items-center gap-1"><i className="block h-[7px] w-[7px] rounded-full bg-terra" />{t('todo.legendOpen')}</span>
          <span className="flex items-center gap-1"><i className="block h-[7px] w-[7px] rounded-full bg-wisteria" />{t('todo.legendCalendar')}</span>
        </div>
      )}
    </div>
  )
}

/**
 * The todo list with a week strip or a month calendar, the chosen day's todos, the month plan and the undated todos.
 * `detailed` shows titles in the month cells (tablet and PC); `wide` lays the cards out in two columns (PC).
 */
export function TodayTodos({ detailed = false, wide = false }: { detailed?: boolean; wide?: boolean }) {
  const h = useHousehold()
  const [day, setDay] = useState<Ymd>(h.today)
  const [view, setView] = useState<TodoView>(readTodoView)
  const [ym, setYm] = useState<Ym>(monthOf(h.today))
  // null: closed; { todo: null }: a new todo on the chosen day.
  const [sheet, setSheet] = useState<{ todo: Todo | null } | null>(null)
  const setEditing = (todo: Todo) => setSheet({ todo })
  const [nudge, setNudge] = useState<Todo | null>(null)
  const dated = sortTodos(h.todos.filter((x) => x.date === day))
  const undated = sortTodos(h.todos.filter((x) => !x.date && !isMonthPlan(x) && (!x.done || (x.doneAt ?? 0) > Date.now() - 86_400_000)))

  const changeView = (v: TodoView) => {
    setView(v)
    writeTodoView(v)
    if (v === 'month') setYm(monthOf(day))
  }
  const pick = (d: Ymd) => {
    setDay(d)
    if (monthOf(d) !== ym) setYm(monthOf(d))
  }
  const moveMonth = (n: number) => {
    const next = addMonths(ym, n)
    setYm(next)
    setDay(next === monthOf(h.today) ? h.today : `${next}-01`)
  }
  const goToday = () => pick(h.today)
  const monday = weekStart(day)
  const nav = view === 'week'
    ? {
        label: weekLabel(monday),
        onPrev: () => pick(addDays(day, -7)), onNext: () => pick(addDays(day, 7)),
        prevLabel: t('todo.prevWeek'), nextLabel: t('todo.nextWeek'), showToday: weekStart(h.today) !== monday,
      }
    : {
        label: t('todo.monthTitle', { y: Number(ym.slice(0, 4)), m: monthNumber(ym) }),
        onPrev: () => moveMonth(-1), onNext: () => moveMonth(1),
        prevLabel: t('todo.prevMonth'), nextLabel: t('todo.nextMonth'), showToday: ym !== monthOf(h.today) || day !== h.today,
      }

  const dayCard = (
    <Card>
      <CardHeader title={formatDay(day)} action={<span className="text-[12px] text-ink-2">{t('todo.countLeft', { n: dated.filter((x) => !x.done).length })}</span>} />
      {dated.length === 0 && <Empty>{t('todo.emptyDay')}</Empty>}
      <div className="divide-y divide-line">
        {dated.map((x) => <TodoRow key={x.id} todo={x} onEdit={setEditing} onNudge={setNudge} />)}
      </div>
      <AddButton label={t('todo.addOnDay')} onClick={() => setSheet({ todo: null })} />
    </Card>
  )
  const planCard = <MonthPlanCard ym={view === 'month' ? ym : monthOf(day)} />
  const undatedCard = (
    <Card>
      <CardHeader title={t('todo.undatedTitle')} />
      {undated.length === 0 && <Empty>{t('todo.emptyUndated')}</Empty>}
      <div className="divide-y divide-line">
        {undated.map((x) => <TodoRow key={x.id} todo={x} onEdit={setEditing} onNudge={setNudge} />)}
      </div>
    </Card>
  )

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <NavRow {...nav} view={view} onView={changeView} onToday={goToday} />
        {view === 'week' ? <WeekStrip selected={day} onSelect={pick} /> : <MonthGrid ym={ym} selected={day} onSelect={pick} detailed={detailed} />}
      </Card>
      {wide ? (
        <div className="grid grid-cols-2 items-start gap-4">
          <div className="flex flex-col gap-4">{dayCard}{undatedCard}</div>
          {planCard}
        </div>
      ) : (
        <>{dayCard}{planCard}{undatedCard}</>
      )}
      <TodoSheet open={sheet !== null} onClose={() => setSheet(null)} todo={sheet?.todo ?? null} defaultDate={day} />
      <NudgeSheet target={nudge && { type: 'todo', id: nudge.id, title: nudge.title }} onClose={() => setNudge(null)} />
    </div>
  )
}


function RoutineProgress() {
  const h = useHousehold()
  const list = routinesForDay(h.routines, h.today)
  const done = list.filter((r) => isRoutineDone(h.routineLogs, r.id, h.today)).length
  return <span className="text-[12px] text-ink-2">{t('routine.progress', { done, total: list.length })}</span>
}

export function TodosScreen({ section, onSection, wide = false, detailed = false }: {
  section: TodoSection; onSection: (s: TodoSection) => void; wide?: boolean; detailed?: boolean
}) {
  if (wide) {
    // PC: the todo list takes two columns, routines and chores share the third.
    return (
      <div className="mx-auto grid max-w-[1360px] grid-cols-3 items-start gap-5">
        <div className="col-span-2"><TodayTodos detailed wide /></div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title={t('routine.title')} action={<RoutineProgress />} />
            <RoutineChecklist />
          </Card>
          <Card>
            <CardHeader title={t('chore.title')} />
            <ChoreList />
          </Card>
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <Segmented
        value={section}
        onChange={onSection}
        options={[
          { value: 'today', label: t('todos.tab.today') },
          { value: 'routines', label: t('todos.tab.routines') },
          { value: 'chores', label: t('todos.tab.chores') },
        ]}
      />
      {section === 'today' && <TodayTodos detailed={detailed} />}
      {section === 'routines' && (
        <Card>
          <CardHeader title={t('routine.title')} />
          <RoutineChecklist />
        </Card>
      )}
      {section === 'chores' && (
        <Card>
          <CardHeader title={t('chore.title')} />
          <ChoreList />
        </Card>
      )}
    </div>
  )
}
