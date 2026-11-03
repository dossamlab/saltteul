import { doc, onSnapshot } from 'firebase/firestore'
import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { monthNumber, monthOf, monthPlans, type Ym } from '../../shared/monthPlan'
import type { MonthNote, Todo } from '../../shared/types'
import { t } from '../copy'
import { saveMonthNote } from '../data/actions'
import { useHousehold } from '../data/store'
import { db } from '../firebase'
import { AddButton, NudgeSheet, sortTodos, TodoRow, TodoSheet } from './TodoParts'
import { Button, Card, CardHeader } from './ui'

function useMonthNote(hid: string, ym: Ym): MonthNote | null {
  const [note, setNote] = useState<{ ym: Ym; note: MonthNote | null } | null>(null)
  useEffect(
    () => onSnapshot(doc(db, `households/${hid}/monthNotes/${ym}`), (d) => setNote({ ym, note: d.exists() ? (d.data() as MonthNote) : null }),
      () => setNote({ ym, note: null })),
    [hid, ym],
  )
  return note?.ym === ym ? note.note : null
}

/** The month's shared memo: tap to edit in place, saved for both members. */
function MonthMemo({ ym }: { ym: Ym }) {
  const h = useHousehold()
  const note = useMonthNote(h.hid, ym)
  const [draft, setDraft] = useState<string | null>(null)
  const save = async () => {
    if (draft === null) return
    if (draft.trim() !== (note?.text ?? '')) await saveMonthNote(h.hid, h.uid, ym, draft)
    setDraft(null)
  }
  if (draft !== null) {
    return (
      <div className="rounded-[var(--radius-field)] bg-peach-soft p-3">
        <p className="mb-1.5 text-[11px] font-bold text-terra-2">{t('plan.memoLabel')}</p>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={4} placeholder={t('plan.memoPlaceholder')}
          aria-label={t('plan.memoLabel')}
          className="w-full resize-none rounded-lg bg-white px-3 py-2 text-[14px] leading-relaxed text-ink outline-none" />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" className="h-9 px-3 text-[13px]" onClick={() => setDraft(null)}>{t('action.cancel')}</Button>
          <Button className="h-9 px-4 text-[13px]" onClick={save}>{t('action.save')}</Button>
        </div>
      </div>
    )
  }
  return (
    <button type="button" onClick={() => setDraft(note?.text ?? '')}
      className="w-full rounded-[var(--radius-field)] bg-peach-soft px-3.5 py-3 text-left">
      <span className="mb-1 flex items-center justify-between text-[11px] font-bold text-terra-2">
        {t('plan.memoLabel')}
        <span className="flex items-center gap-1 font-semibold text-ink-3"><Pencil size={12} />{t('plan.memoEdit')}</span>
      </span>
      {note?.text
        ? <span className="block whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{note.text}</span>
        : <span className="block text-[14px] text-ink-3">{t('plan.memoPlaceholder')}</span>}
    </button>
  )
}

/**
 * 「N월 계획」: the month's memo and the todos meant for that month without a date. For the current month, open plans
 * of earlier months are listed first with where they came from.
 */
export function MonthPlanCard({ ym }: { ym: Ym }) {
  const h = useHousehold()
  const [sheet, setSheet] = useState<{ todo: Todo | null } | null>(null)
  const [nudge, setNudge] = useState<Todo | null>(null)
  const { own, carried } = monthPlans(h.todos, ym, monthOf(h.today))
  const list = [...sortTodos(carried), ...sortTodos(own)]
  const done = own.filter((x) => x.done).length
  const total = own.length + carried.length
  const m = monthNumber(ym)
  return (
    <Card>
      <CardHeader title={t('plan.title', { m })}
        action={total ? <span className="text-[12px] text-ink-2">{t('plan.progress', { done, total })}</span> : undefined} />
      <MonthMemo ym={ym} />
      <div className="mt-4 flex items-center justify-between text-[12px] font-bold text-ink-2">
        <span>{t('plan.listLabel')}</span>
        {total > 0 && <span>{t('plan.left', { n: total - done })}</span>}
      </div>
      {total > 0 && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-sage-2" style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
      )}
      {total === 0 && <p className="py-3 text-center text-[13px] text-ink-2">{t('plan.empty')}</p>}
      <div className="divide-y divide-line">
        {list.map((x) => (
          <TodoRow key={x.id} todo={x} onEdit={(todo) => setSheet({ todo })} onNudge={setNudge}
            tag={x.month !== ym && x.month ? t('plan.carried', { m: monthNumber(x.month) }) : undefined} />
        ))}
      </div>
      <AddButton label={t('plan.add', { m })} onClick={() => setSheet({ todo: null })} />
      <TodoSheet open={sheet !== null} onClose={() => setSheet(null)} todo={sheet?.todo ?? null} month={ym} />
      <NudgeSheet target={nudge && { type: 'todo', id: nudge.id, title: nudge.title }} onClose={() => setNudge(null)} />
    </Card>
  )
}
