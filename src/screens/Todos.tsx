import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { addDays, weekdayOf } from '../../shared/householdDate'
import { addMonths, isMonthPlan, monthGrid, monthNumber, monthOf, weekStart, type Ym } from '../../shared/monthPlan'
import { isRoutineDone, routinesForDay } from '../../shared/routines'
import { layoutWeek, occursOn } from '../../shared/todoDays'
import type { Owner, Todo, Ymd } from '../../shared/types'
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
        const open = h.todos.filter((x) => occursOn(x, d) && !x.done).length
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
const OWNERS: Owner[] = ['wife', 'husband', 'both']
/** Pastel bar per owner, the same colours as the calendar widget. */
const OWNER_BAR: Record<Owner, string> = {
  wife: 'bg-owner-wife text-owner-wife-ink',
  husband: 'bg-owner-husband text-owner-husband-ink',
  both: 'bg-owner-both text-owner-both-ink',
}
const MAX_LANES = 3

/**
 * Monday-first month, one grid per week: the day buttons fill the columns and the todo bars lie on top of them
 * (a multi-day todo is one bar from its first to its last day, continued on the next week's row). Up to three bars a
 * day, then 「+n」; done todos stay, faded. Phone: short bars; tablet and PC (`detailed`): taller bars with times.
 */
function MonthGrid({ ym, selected, onSelect, detailed }: { ym: Ym; selected: Ymd; onSelect: (d: Ymd) => void; detailed: boolean }) {
  const h = useHousehold()
  const days = monthGrid(ym)
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7))
  const dated = sortTodos(h.todos.filter((x) => !!x.date))
  const rows = detailed ? `32px repeat(${MAX_LANES}, 20px) 18px` : `28px repeat(${MAX_LANES}, 15px) 13px`
  return (
    <div>
      <div className="grid grid-cols-7 pb-1.5">
        {WEEK_HEAD.map((wd) => (
          <span key={wd} className={`text-center text-[11px] font-semibold ${wd === 0 ? 'text-terra' : wd === 6 ? 'text-[#5a7fb0]' : 'text-ink-3'}`}>{weekdayShort(wd)}</span>
        ))}
      </div>
      <div className={detailed ? 'border-l border-t border-line' : 'flex flex-col gap-0.5'}>
        {weeks.map((week) => {
          const { bars, more } = layoutWeek(dated, week[0], MAX_LANES)
          return (
            <div key={week[0]} className="grid grid-cols-[repeat(7,minmax(0,1fr))]" style={{ gridTemplateRows: rows }}>
              {week.map((d, i) => {
                const out = monthOf(d) !== ym
                const active = d === selected
                const left = dated.filter((x) => occursOn(x, d) && !x.done).length
                return (
                  <button key={d} type="button" onClick={() => onSelect(d)} aria-pressed={active}
                    aria-label={`${formatDay(d)} ${t('todo.countLeft', { n: left })}`}
                    style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
                    className={`flex min-w-0 flex-col items-center pt-1 ${detailed ? 'border-b border-r border-line' : 'rounded-xl'} ${active ? 'bg-sage-soft' : ''}`}>
                    <span className={`grid h-[22px] min-w-[22px] place-items-center rounded-full px-1 text-[13px] font-semibold ${
                      d === h.today ? 'bg-sage text-white' : out ? 'text-ink-3' : dayTone(d)}`}>
                      {Number(d.slice(8))}
                    </span>
                  </button>
                )
              })}
              {bars.map((b) => (
                <span key={b.todo.id} aria-hidden
                  style={{ gridColumn: `${b.col + 1} / span ${b.span}`, gridRow: b.lane + 2 }}
                  className={`pointer-events-none z-[1] my-px flex min-w-0 items-center overflow-hidden px-1 font-semibold leading-none ${
                    detailed ? 'text-[11px]' : 'text-[10px]'} ${OWNER_BAR[b.todo.owner] ?? OWNER_BAR.both} ${b.todo.done ? 'opacity-40' : ''} ${
                    b.fromBefore ? 'ml-0 rounded-l-none' : 'ml-[2px] rounded-l-[4px]'} ${b.toAfter ? 'mr-0 rounded-r-none' : 'mr-[2px] rounded-r-[4px]'}`}>
                  <span className="truncate">{detailed && b.todo.time && !b.fromBefore ? `${b.todo.time} ` : ''}{b.todo.title}</span>
                </span>
              ))}
              {more.map((n, i) => n > 0 && (
                <span key={`more${i}`} aria-hidden style={{ gridColumn: i + 1, gridRow: MAX_LANES + 2 }}
                  className="pointer-events-none z-[1] self-center text-center text-[9px] font-bold leading-none text-ink-2">
                  {t(detailed ? 'todo.moreInDay' : 'todo.moreShort', { n })}
                </span>
              ))}
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-ink-2">
        {OWNERS.map((o) => (
          <span key={o} className="flex items-center gap-1"><i className={`block h-2 w-3.5 rounded-[3px] ${OWNER_BAR[o]}`} />{h.nameOf(o)}</span>
        ))}
      </div>
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
  const dated = sortTodos(h.todos.filter((x) => occursOn(x, day)))
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
