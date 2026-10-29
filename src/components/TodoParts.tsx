import { BellRing, CalendarCheck2, School, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Owner, Todo } from '../../shared/types'
import { t } from '../copy'
import { addTodo, deleteTodo, sendNudge, toggleTodo, updateTodo, type TodoDraft } from '../data/actions'
import { useHousehold } from '../data/store'
import { timeLabel } from '../format'
import { Button, Checkbox, Field, IconButton, OwnerBadge, OwnerPicker, Pill, Sheet } from './ui'

export function TodoRow({ todo, onEdit, onNudge }: { todo: Todo; onEdit: (t: Todo) => void; onNudge?: (t: Todo) => void }) {
  const h = useHousehold()
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="pt-0.5">
        <Checkbox checked={todo.done} onChange={() => toggleTodo(h.hid, todo, h.uid)} label={todo.title} />
      </div>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(todo)}>
        <p className={`text-[15px] leading-snug ${todo.done ? 'done-text' : 'text-ink'}`}>{todo.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
          {todo.time && <span>{timeLabel(todo.time)}</span>}
          <OwnerBadge owner={todo.owner} name={h.nameOf(todo.owner)} />
          {todo.source === 'kidsnote' && (
            <Pill tone="ai">
              <School size={12} />
              {t('badge.kidsnote')}
            </Pill>
          )}
          {todo.calendarEventId && (
            <Pill>
              <CalendarCheck2 size={12} />
              {t('badge.googleSynced')}
            </Pill>
          )}
          {todo.done && todo.doneBy && <span>{t('todo.doneBy', { name: h.nameOf(todo.doneBy) })}</span>}
        </div>
        {!!todo.prepItems?.length && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {todo.prepItems.map((p) => (
              <Pill key={p.name} tone={p.source === 'inferred' ? 'ai' : 'sage'}>
                {p.source === 'inferred' && <Sparkles size={11} />}
                {p.name}
                {p.source === 'inferred' && <span className="opacity-70">{t('badge.suggested')}</span>}
              </Pill>
            ))}
          </div>
        )}
      </button>
      {onNudge && !todo.done && (
        <IconButton label={t('nudge.button', { name: h.partner?.displayName || t('owner.partner') })} onClick={() => onNudge(todo)}>
          <BellRing size={18} />
        </IconButton>
      )}
    </div>
  )
}

export function TodoSheet({ open, onClose, todo, defaultDate }: { open: boolean; onClose: () => void; todo?: Todo | null; defaultDate?: string | null }) {
  const h = useHousehold()
  const [draft, setDraft] = useState<TodoDraft>(() => fromTodo(todo, defaultDate, h.me?.role ?? 'both'))
  const [key, setKey] = useState(todo?.id ?? 'new')
  if ((todo?.id ?? 'new') !== key) {
    setKey(todo?.id ?? 'new')
    setDraft(fromTodo(todo, defaultDate, h.me?.role ?? 'both'))
  }
  const names = { husband: h.nameOf('husband'), wife: h.nameOf('wife'), both: h.nameOf('both') }

  const save = async () => {
    if (!draft.title.trim()) return
    if (todo) await updateTodo(h.hid, todo.id, { ...draft, date: draft.date || null, time: draft.time || null })
    else await addTodo(h.hid, draft)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={todo ? t('todo.editTitle') : t('todo.addTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('field.title')} value={draft.title} autoFocus placeholder={t('todo.titlePlaceholder')}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('field.date')} type="date" value={draft.date ?? ''} onChange={(e) => setDraft({ ...draft, date: e.target.value || null })} />
          <Field label={t('field.time')} type="time" value={draft.time ?? ''} onChange={(e) => setDraft({ ...draft, time: e.target.value || null })} />
        </div>
        <OwnerPicker value={draft.owner} onChange={(owner) => setDraft({ ...draft, owner })} names={names} />
        <Field label={t('field.note')} value={draft.note ?? ''} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        {draft.date ? <p className="text-[12px] text-ink-2">{t('todo.calendarHint')}</p> : null}
        <div className="flex gap-2">
          {todo && (
            <Button variant="soft" onClick={async () => { await deleteTodo(h.hid, todo.id); onClose() }} aria-label={t('action.delete')}>
              <Trash2 size={18} />
            </Button>
          )}
          <Button className="flex-1" onClick={save} disabled={!draft.title.trim()}>{t('action.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

function fromTodo(todo: Todo | null | undefined, defaultDate: string | null | undefined, myRole: Owner): TodoDraft {
  return {
    title: todo?.title ?? '',
    owner: todo?.owner ?? myRole,
    note: todo?.note ?? '',
    date: todo ? todo.date ?? null : defaultDate ?? null,
    time: todo?.time ?? null,
  }
}

export function NudgeSheet({
  target, onClose,
}: { target: { type: 'todo' | 'shopping' | 'routine' | 'chore' | null; id?: string; title?: string } | null; onClose: () => void }) {
  const h = useHousehold()
  const [message, setMessage] = useState('')
  const partner = h.partner
  const send = async () => {
    if (!partner) return
    await sendNudge(h.hid, {
      from: h.uid, to: partner.uid, targetType: target?.type ?? null, targetId: target?.id ?? null,
      targetTitle: target?.title ?? null, message: message.trim() || undefined,
    })
    setMessage('')
    onClose()
  }
  return (
    <Sheet open={!!target} onClose={onClose} title={t('nudge.sheetTitle', { name: partner?.displayName || t('owner.partner') })}>
      <div className="flex flex-col gap-4">
        {target?.title && <p className="rounded-[var(--radius-field)] bg-muted px-3.5 py-3 text-[15px]">{target.title}</p>}
        <Field label={t('nudge.messageLabel')} placeholder={t('nudge.messagePlaceholder')} value={message} onChange={(e) => setMessage(e.target.value)} />
        {!partner && <p className="text-[13px] text-terra-2">{t('nudge.noPartner')}</p>}
        <Button variant="urgent" onClick={send} disabled={!partner}>
          <BellRing size={18} />
          {t('nudge.send')}
        </Button>
      </div>
    </Sheet>
  )
}
