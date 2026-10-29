import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { choreStatus, sortChores } from '../../shared/chores'
import { isRoutineDone, routinesForDay } from '../../shared/routines'
import type { Chore, Owner, Routine } from '../../shared/types'
import { t } from '../copy'
import {
  addChore, addRoutine, deleteChore, deleteRoutine, markChoreDone, toggleRoutine, undoChoreDone, updateChore, updateRoutine,
} from '../data/actions'
import { useHousehold } from '../data/store'
import { relativeDay, weekdayShort } from '../format'
import { Button, Checkbox, Empty, Field, IconButton, OwnerBadge, OwnerPicker, Pill, Sheet } from './ui'

export function RoutineChecklist({ compact = false }: { compact?: boolean }) {
  const h = useHousehold()
  const [editing, setEditing] = useState<Routine | 'new' | null>(null)
  const list = routinesForDay(h.routines, h.today)
  const shown = compact ? list.filter((r) => !isRoutineDone(h.routineLogs, r.id, h.today)).slice(0, 4) : list
  return (
    <div>
      {list.length === 0 && <Empty>{t('routine.empty')}</Empty>}
      {compact && list.length > 0 && shown.length === 0 && <Empty>{t('routine.allDone')}</Empty>}
      {shown.map((r) => {
        const log = h.routineLogs.find((l) => l.routineId === r.id && l.day === h.today)
        return (
          <div key={r.id} className="flex items-center gap-3 py-2.5">
            <Checkbox checked={!!log} label={r.title} onChange={() => toggleRoutine(h.hid, r.id, h.today, !!log, h.uid)} />
            <div className="min-w-0 flex-1">
              <p className={`text-[15px] ${log ? 'done-text' : ''}`}>{r.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
                <OwnerBadge owner={r.owner} name={h.nameOf(r.owner)} />
                {r.weekdays?.length ? <span>{r.weekdays.map(weekdayShort).join(' ')}</span> : null}
                {log && <span>{t('routine.doneBy', { name: h.nameOf(log.doneBy) })}</span>}
              </div>
            </div>
            {!compact && (
              <IconButton label={t('action.edit')} onClick={() => setEditing(r)}>
                <Pencil size={16} />
              </IconButton>
            )}
          </div>
        )
      })}
      {!compact && (
        <Button variant="soft" className="mt-2 w-full" onClick={() => setEditing('new')}>
          <Plus size={18} />
          {t('routine.add')}
        </Button>
      )}
      <RoutineSheet editing={editing} onClose={() => setEditing(null)} />
      {!compact && <p className="mt-3 text-[12px] text-ink-2">{t('routine.resetHint')}</p>}
    </div>
  )
}

function RoutineSheet({ editing, onClose }: { editing: Routine | 'new' | null; onClose: () => void }) {
  const h = useHousehold()
  const current = editing && editing !== 'new' ? editing : null
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState<Owner>('both')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [key, setKey] = useState<string | null>(null)
  const k = editing === null ? null : current?.id ?? 'new'
  if (k !== key) {
    setKey(k)
    setTitle(current?.title ?? '')
    setOwner(current?.owner ?? 'both')
    setWeekdays(current?.weekdays ?? [])
  }
  const names = { husband: h.nameOf('husband'), wife: h.nameOf('wife'), both: h.nameOf('both') }
  const save = async () => {
    if (!title.trim()) return
    const data = { title: title.trim(), owner, weekdays: weekdays.length ? [...weekdays].sort() : null }
    if (current) await updateRoutine(h.hid, current.id, data)
    else await addRoutine(h.hid, { ...data, order: h.routines.length, active: true })
    onClose()
  }
  return (
    <Sheet open={editing !== null} onClose={onClose} title={current ? t('routine.editTitle') : t('routine.addTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('field.title')} value={title} autoFocus placeholder={t('routine.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
        <OwnerPicker value={owner} onChange={setOwner} names={names} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">{t('routine.weekdays')}</span>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
              <button key={wd} type="button"
                onClick={() => setWeekdays((w) => (w.includes(wd) ? w.filter((x) => x !== wd) : [...w, wd]))}
                className={`h-10 flex-1 rounded-full text-[13px] font-semibold ${weekdays.includes(wd) ? 'bg-sage text-white' : 'bg-muted text-ink-2'}`}>
                {weekdayShort(wd)}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-ink-2">{t('routine.weekdaysHint')}</span>
        </div>
        <div className="flex gap-2">
          {current && (
            <Button variant="soft" aria-label={t('action.delete')} onClick={async () => { await deleteRoutine(h.hid, current.id); onClose() }}>
              <Trash2 size={18} />
            </Button>
          )}
          <Button className="flex-1" onClick={save} disabled={!title.trim()}>{t('action.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

export function ChoreList({ compact = false }: { compact?: boolean }) {
  const h = useHousehold()
  const [editing, setEditing] = useState<Chore | 'new' | null>(null)
  const sorted = sortChores(h.chores, h.today)
  const shown = compact ? sorted.filter((c) => choreStatus(c, h.today).kind !== 'left').slice(0, 3) : sorted
  return (
    <div>
      {h.chores.length === 0 && <Empty>{t('chore.empty')}</Empty>}
      {compact && h.chores.length > 0 && shown.length === 0 && <Empty>{t('chore.noneDue')}</Empty>}
      {shown.map((c) => {
        const st = choreStatus(c, h.today)
        const doneToday = c.lastDone === h.today
        return (
          <div key={c.id} className={`flex items-center gap-3 py-2.5 ${st.kind === 'overdue' ? 'text-terra-2' : ''}`}>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] text-ink">{c.title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
                <OwnerBadge owner={c.owner} name={h.nameOf(c.owner)} />
                <Pill tone={st.kind === 'overdue' ? 'terra' : st.kind === 'today' ? 'sage' : 'muted'}>
                  {st.kind === 'overdue' ? t('chore.overdue', { n: st.days }) : st.kind === 'today' ? t('chore.today') : t('chore.left', { n: st.days })}
                </Pill>
                <span>{t('chore.cycle', { n: c.cycleDays })}</span>
                {c.lastDone && <span>{t('chore.lastDone', { day: relativeDay(c.lastDone, h.today) })}</span>}
              </div>
            </div>
            {doneToday ? (
              <IconButton label={t('chore.undo')} onClick={() => undoChoreDone(h.hid, c)}>
                <RotateCcw size={16} />
              </IconButton>
            ) : (
              <Button variant={st.kind === 'overdue' ? 'urgent' : 'soft'} className="h-9 px-3.5 text-[13px]" onClick={() => markChoreDone(h.hid, c, h.today, h.uid)}>
                {t('chore.markDone')}
              </Button>
            )}
            {!compact && (
              <IconButton label={t('action.edit')} onClick={() => setEditing(c)}>
                <Pencil size={16} />
              </IconButton>
            )}
          </div>
        )
      })}
      {!compact && (
        <Button variant="soft" className="mt-2 w-full" onClick={() => setEditing('new')}>
          <Plus size={18} />
          {t('chore.add')}
        </Button>
      )}
      <ChoreSheet editing={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function ChoreSheet({ editing, onClose }: { editing: Chore | 'new' | null; onClose: () => void }) {
  const h = useHousehold()
  const current = editing && editing !== 'new' ? editing : null
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState<Owner>('both')
  const [cycle, setCycle] = useState('7')
  const [lastDone, setLastDone] = useState('')
  const [key, setKey] = useState<string | null>(null)
  const k = editing === null ? null : current?.id ?? 'new'
  if (k !== key) {
    setKey(k)
    setTitle(current?.title ?? '')
    setOwner(current?.owner ?? 'both')
    setCycle(String(current?.cycleDays ?? 7))
    setLastDone(current?.lastDone ?? '')
  }
  const names = { husband: h.nameOf('husband'), wife: h.nameOf('wife'), both: h.nameOf('both') }
  const days = Math.max(1, Math.round(Number(cycle) || 0))
  const save = async () => {
    if (!title.trim()) return
    const data = { title: title.trim(), owner, cycleDays: days, lastDone: lastDone || null }
    if (current) await updateChore(h.hid, current.id, data)
    else await addChore(h.hid, { ...data, createdDay: h.today, history: [] })
    onClose()
  }
  return (
    <Sheet open={editing !== null} onClose={onClose} title={current ? t('chore.editTitle') : t('chore.addTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('field.title')} value={title} autoFocus placeholder={t('chore.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <Field label={t('chore.cycleLabel')} type="number" inputMode="numeric" min={1} value={cycle} onChange={(e) => setCycle(e.target.value)} />
          <div className="flex gap-1.5">
            {[7, 14, 30].map((n) => (
              <button key={n} type="button" onClick={() => setCycle(String(n))}
                className={`h-9 flex-1 rounded-full text-[13px] font-semibold ${days === n ? 'bg-sage text-white' : 'bg-muted text-ink-2'}`}>
                {t('chore.cycle', { n })}
              </button>
            ))}
          </div>
        </div>
        <Field label={t('chore.lastDoneLabel')} type="date" value={lastDone} onChange={(e) => setLastDone(e.target.value)} />
        <OwnerPicker value={owner} onChange={setOwner} names={names} />
        <p className="text-[12px] text-ink-2">{t('chore.cycleHint')}</p>
        <div className="flex gap-2">
          {current && (
            <Button variant="soft" aria-label={t('action.delete')} onClick={async () => { await deleteChore(h.hid, current.id); onClose() }}>
              <Trash2 size={18} />
            </Button>
          )}
          <Button className="flex-1" onClick={save} disabled={!title.trim()}>{t('action.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}
