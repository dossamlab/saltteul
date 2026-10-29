import { Plus } from 'lucide-react'
import { useState } from 'react'
import { addDays, weekdayOf } from '../../shared/householdDate'
import { isRoutineDone, routinesForDay } from '../../shared/routines'
import type { Todo, Ymd } from '../../shared/types'
import { ChoreList, RoutineChecklist } from '../components/RoutineParts'
import { NudgeSheet, TodoRow, TodoSheet } from '../components/TodoParts'
import { Button, Card, CardHeader, Empty, Segmented } from '../components/ui'
import { t } from '../copy'
import { useHousehold } from '../data/store'
import { formatDay, weekdayShort } from '../format'

export type TodoSection = 'today' | 'routines' | 'chores'

export function sortTodos(list: Todo[]) {
  return [...list].sort((a, b) => Number(a.done) - Number(b.done) || (a.time ?? '99').localeCompare(b.time ?? '99'))
}

function WeekStrip({ selected, onSelect }: { selected: Ymd; onSelect: (d: Ymd) => void }) {
  const h = useHousehold()
  const wd = weekdayOf(h.today)
  const monday = addDays(h.today, wd === 0 ? -6 : 1 - wd)
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map((d) => {
        const open = h.todos.filter((x) => x.date === d && !x.done).length
        const active = d === selected
        return (
          <button key={d} type="button" onClick={() => onSelect(d)}
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

export function TodayTodos() {
  const h = useHousehold()
  const [day, setDay] = useState<Ymd>(h.today)
  const [editing, setEditing] = useState<Todo | 'new' | null>(null)
  const [nudge, setNudge] = useState<Todo | null>(null)
  const dated = sortTodos(h.todos.filter((x) => x.date === day))
  const undated = sortTodos(h.todos.filter((x) => !x.date && (!x.done || (x.doneAt ?? 0) > Date.now() - 86_400_000)))
  return (
    <div className="flex flex-col gap-4">
      <WeekStrip selected={day} onSelect={setDay} />
      <Card>
        <CardHeader title={formatDay(day)} action={<span className="text-[12px] text-ink-2">{t('todo.countLeft', { n: dated.filter((x) => !x.done).length })}</span>} />
        {dated.length === 0 && <Empty>{t('todo.emptyDay')}</Empty>}
        <div className="divide-y divide-line">
          {dated.map((x) => <TodoRow key={x.id} todo={x} onEdit={setEditing} onNudge={setNudge} />)}
        </div>
      </Card>
      <Card>
        <CardHeader title={t('todo.undatedTitle')} />
        {undated.length === 0 && <Empty>{t('todo.emptyUndated')}</Empty>}
        <div className="divide-y divide-line">
          {undated.map((x) => <TodoRow key={x.id} todo={x} onEdit={setEditing} onNudge={setNudge} />)}
        </div>
      </Card>
      <Button onClick={() => setEditing('new')}>
        <Plus size={18} />
        {t('todo.add')}
      </Button>
      <TodoSheet open={editing !== null} onClose={() => setEditing(null)} todo={editing === 'new' ? null : editing} defaultDate={day} />
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

export function TodosScreen({ section, onSection, wide = false }: { section: TodoSection; onSection: (s: TodoSection) => void; wide?: boolean }) {
  if (wide) {
    // PC: the three sections side by side instead of the segmented switch.
    return (
      <div className="mx-auto grid max-w-[1360px] grid-cols-3 items-start gap-5">
        <TodayTodos />
        <Card>
          <CardHeader title={t('routine.title')} action={<RoutineProgress />} />
          <RoutineChecklist />
        </Card>
        <Card>
          <CardHeader title={t('chore.title')} />
          <ChoreList />
        </Card>
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
      {section === 'today' && <TodayTodos />}
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
