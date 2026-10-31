import { ArrowUp, Camera, Loader2, Plus, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { isRoutineDone } from '../../shared/routines'
import type { QuickAddResult, QuickItem } from '../../shared/types'
import { t } from '../copy'
import {
  addPantryItem, addShopping, addTodo, applyPantryOps, extractFromFile, markChoreDone, quickAdd, toggleRoutine,
} from '../data/actions'
import { useHousehold, type HouseholdData } from '../data/store'
import { prepareUpload, UploadError } from '../data/upload'
import { relativeDay, timeLabel } from '../format'
import { Button, Checkbox, IconButton, OwnerBadge, Pill, Sheet } from './ui'
import { VoiceButton } from './VoiceButton'

type Phase =
  | { step: 'input' }
  | { step: 'loading'; from: 'text' | 'file' }
  | { step: 'confirm'; result: QuickAddResult; keep: boolean[]; saving: boolean }
  | { step: 'error'; message: string }

function errorMessage(e: unknown): string {
  if (e instanceof UploadError) {
    return e.code === 'tooLarge' ? t('quick.fileTooLarge') : e.code === 'badType' ? t('quick.fileType') : t('quick.fileDecode')
  }
  const code = (e as { code?: string }).code ?? ''
  if (code.endsWith('resource-exhausted')) return t('quick.errorBusy')
  if (code.endsWith('unavailable') || code.endsWith('deadline-exceeded')) return t('quick.errorNetwork')
  return t('quick.error')
}

/** Writes the kept items with the regular actions. Returns how many were written. */
async function applyItems(h: HouseholdData, items: QuickItem[]): Promise<number> {
  // Pantry changes go in order in one batch, each from the count the previous one left.
  const pantryOps = items.flatMap((it) => (it.kind === 'pantry' ? [{ pantryId: it.pantryId, op: it.op, amount: it.amount }] : []))
  const pantryWrite = pantryOps.length ? applyPantryOps(h.hid, h.uid, h.pantry, pantryOps, 'voice') : Promise.resolve(0)
  const writes = items.map(async (it) => {
    switch (it.kind) {
      case 'todo':
        await addTodo(h.hid, {
          title: it.title, owner: it.owner, date: it.date, time: it.time, note: it.note ?? undefined, prepItems: it.prepItems,
        })
        return 1
      case 'shopping':
        await addShopping(h.hid, h.uid, it.name, { qty: it.qty || undefined, note: it.note || undefined })
        return 1
      case 'routineDone':
        if (!isRoutineDone(h.routineLogs, it.routineId, h.today)) await toggleRoutine(h.hid, it.routineId, h.today, false, h.uid)
        return 1
      case 'choreDone': {
        const chore = h.chores.find((c) => c.id === it.choreId)
        if (!chore) return 0
        if (chore.lastDone !== h.today) await markChoreDone(h.hid, chore, h.today, h.uid)
        return 1
      }
      case 'pantry':
        return 0 // counted with pantryWrite
      case 'pantryNew':
        await addPantryItem(h.hid, h.uid, { name: it.name, unit: it.unit, qty: it.qty, minQty: 1, restockQty: 0 })
        return 1
    }
  })
  const done = await Promise.all([...writes, pantryWrite])
  return done.reduce<number>((a, b) => a + (b ?? 0), 0)
}

const KIND_KEY: Record<QuickItem['kind'], string> = {
  todo: 'quick.kind.todo', shopping: 'quick.kind.shopping', routineDone: 'quick.kind.routine', choreDone: 'quick.kind.chore',
  pantry: 'quick.kind.pantry', pantryNew: 'quick.kind.pantry',
}

function itemLabel(it: QuickItem) {
  return it.kind === 'shopping' || it.kind === 'pantry' || it.kind === 'pantryNew' ? it.name : it.title
}

function ItemRow({ item, checked, onToggle }: { item: QuickItem; checked: boolean; onToggle: () => void }) {
  const h = useHousehold()
  return (
    <div className={`flex items-start gap-3 py-2.5 ${checked ? '' : 'opacity-50'}`}>
      <div className="pt-0.5"><Checkbox checked={checked} onChange={onToggle} label={itemLabel(item)} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug text-ink">
          {itemLabel(item)}
          {item.kind === 'shopping' && item.qty && <span className="ml-1.5 text-[13px] text-ink-2">{item.qty}</span>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
          <Pill tone={item.kind === 'shopping' ? 'terra' : item.kind === 'todo' ? 'muted' : item.kind === 'pantry' || item.kind === 'pantryNew' ? 'ai' : 'sage'}>{t(KIND_KEY[item.kind])}</Pill>
          {item.kind === 'todo' && (
            <>
              <span>{item.date ? relativeDay(item.date, h.today) : t('quick.noDate')}</span>
              {item.time && <span>{timeLabel(item.time)}</span>}
              <OwnerBadge owner={item.owner} name={h.nameOf(item.owner)} />
            </>
          )}
          {(item.kind === 'routineDone' || item.kind === 'choreDone') && <span>{t('quick.markDone')}</span>}
          {item.kind === 'pantry' && (
            <span>{t('quick.pantryChange', { before: `${item.before}${item.unit}`, after: `${item.after}${item.unit}` })}</span>
          )}
          {item.kind === 'pantryNew' && <span>{t('quick.pantryNew', { qty: `${item.qty}${item.unit}` })}</span>}
          {item.kind === 'shopping' && item.note && <span>{item.note}</span>}
        </div>
        {item.kind === 'todo' && item.note && <p className="mt-1 text-[13px] text-ink-2">{item.note}</p>}
        {item.kind === 'todo' && !!item.prepItems?.length && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {item.prepItems.map((p) => <Pill key={p.name} tone={p.source === 'inferred' ? 'ai' : 'sage'}>{p.name}</Pill>)}
          </div>
        )}
      </div>
    </div>
  )
}

function Toast({ text }: { text: string }) {
  if (!text) return null
  return createPortal(
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-5 min-[900px]:bottom-8">
      <p className="rounded-full bg-ink px-5 py-3 text-[14px] font-semibold text-white shadow-[var(--shadow-sheet)]">{text}</p>
    </div>,
    document.body,
  )
}

/**
 * Quick add: one line of text (or a newsletter photo/PDF) -> Claude proposes items -> the user keeps some -> written.
 * variant 'fab' = phone round button that opens the sheet; 'bar' = inline input for tablet and PC.
 */
export function QuickCapture({ variant }: { variant: 'fab' | 'bar' }) {
  const h = useHousehold()
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase | null>(null)
  const [toast, setToast] = useState('')
  const [voiceStatus, setVoiceStatus] = useState<{ text: string; tone: 'info' | 'error' }>({ text: '', tone: 'info' })
  const fileRef = useRef<HTMLInputElement>(null)
  const appendVoice = (said: string) => setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${said}` : said))
  const onVoiceStatus = (text: string, tone: 'info' | 'error') => setVoiceStatus({ text, tone })
  const voiceLine = voiceStatus.text && (
    <p role={voiceStatus.tone === 'error' ? 'alert' : 'status'}
      className={`text-[12px] ${voiceStatus.tone === 'error' ? 'text-terra-2' : 'text-ink-2'}`}>{voiceStatus.text}</p>
  )
  const req = useRef(0)

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 2800)
    return () => clearTimeout(id)
  }, [toast])

  const close = () => {
    req.current++
    setPhase(null)
  }
  const show = (id: number, result: QuickAddResult) => {
    if (id !== req.current) return
    setPhase({ step: 'confirm', result, keep: result.items.map(() => true), saving: false })
  }
  const fail = (id: number, e: unknown) => {
    if (id === req.current) setPhase({ step: 'error', message: errorMessage(e) })
  }

  const runText = async (value: string) => {
    if (!value.trim()) return
    const id = ++req.current
    setPhase({ step: 'loading', from: 'text' })
    try {
      show(id, (await quickAdd(value.trim())).data)
    } catch (e) {
      fail(id, e)
    }
  }

  const runFile = async (file: File) => {
    const id = ++req.current
    setPhase({ step: 'loading', from: 'file' })
    try {
      const payload = await prepareUpload(file)
      show(id, (await extractFromFile(payload)).data)
    } catch (e) {
      fail(id, e)
    }
  }

  const apply = async () => {
    if (phase?.step !== 'confirm') return
    const kept = phase.result.items.filter((_, i) => phase.keep[i])
    setPhase({ ...phase, saving: true })
    try {
      const n = await applyItems(h, kept)
      req.current++
      setPhase(null)
      setText('')
      setToast(t('quick.added', { n }))
    } catch {
      setPhase({ step: 'error', message: t('quick.saveFailed') })
    }
  }

  const pickFile = () => fileRef.current?.click()
  const fileInput = (
    <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) void runFile(f)
      }} />
  )

  const submitBar = (e: FormEvent) => {
    e.preventDefault()
    void runText(text)
  }

  const keptCount = phase?.step === 'confirm' ? phase.keep.filter(Boolean).length : 0

  const sheet = (
    <Sheet open={phase !== null} onClose={close} title={t('quick.title')}>
      {phase?.step === 'input' && (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void runText(text) }}>
          <div className="flex items-start gap-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus
              placeholder={t('quick.placeholder')} aria-label={t('quick.title')}
              className="min-w-0 flex-1 resize-none rounded-[var(--radius-field)] border border-sand bg-white px-3.5 py-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-sage focus:ring-[1.5px] focus:ring-sage" />
            <VoiceButton onText={appendVoice} onStatus={onVoiceStatus} />
          </div>
          {voiceLine || <p className="text-[12px] text-ink-2">{t('quick.hint')}</p>}
          <Button type="submit" disabled={!text.trim()}><Sparkles size={18} />{t('quick.submit')}</Button>
          <div className="my-1 h-px bg-line" />
          <Button type="button" variant="soft" onClick={pickFile}><Camera size={18} />{t('quick.fromFile')}</Button>
          <p className="text-[12px] text-ink-2">{t('quick.fileHint')}</p>
        </form>
      )}

      {phase?.step === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Loader2 size={28} className="animate-spin text-wisteria" />
          <p className="text-[15px] text-ink">{t(phase.from === 'file' ? 'quick.loadingFile' : 'quick.loadingText')}</p>
        </div>
      )}

      {phase?.step === 'confirm' && (
        <div className="flex flex-col gap-3">
          {phase.result.items.length === 0
            ? <p className="py-3 text-center text-[14px] text-ink-2">{t('quick.nothingFound')}</p>
            : <p className="text-[13px] text-ink-2">{t('quick.confirmHint')}</p>}
          <div className="divide-y divide-line">
            {phase.result.items.map((it, i) => (
              <ItemRow key={i} item={it} checked={phase.keep[i]}
                onToggle={() => setPhase({ ...phase, keep: phase.keep.map((k, j) => (j === i ? !k : k)) })} />
            ))}
          </div>
          {phase.result.unparsed.length > 0 && (
            <div className="rounded-[var(--radius-field)] bg-muted px-3.5 py-3">
              <p className="mb-1 text-[12px] font-semibold text-ink-2">{t('quick.unparsedTitle')}</p>
              {phase.result.unparsed.map((u, i) => <p key={i} className="text-[13px] leading-relaxed text-ink-3">{u}</p>)}
            </div>
          )}
          <div className="mt-1 flex gap-2">
            <Button variant="soft" onClick={close}>{t('action.cancel')}</Button>
            <Button className="flex-1" disabled={!keptCount || phase.saving} onClick={apply}>
              {phase.saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
              {t('quick.apply', { n: keptCount })}
            </Button>
          </div>
        </div>
      )}

      {phase?.step === 'error' && (
        <div className="flex flex-col gap-4">
          <p role="alert" className="rounded-[var(--radius-field)] bg-peach-soft px-3.5 py-3 text-[14px] text-terra-2">{phase.message}</p>
          <div className="flex gap-2">
            <Button variant="soft" className="flex-1" onClick={close}>{t('action.close')}</Button>
            {variant === 'fab' && <Button className="flex-1" onClick={() => setPhase({ step: 'input' })}>{t('quick.retry')}</Button>}
          </div>
        </div>
      )}
    </Sheet>
  )

  if (variant === 'fab') {
    return (
      <>
        <button type="button" aria-label={t('quick.title')} title={t('quick.title')} onClick={() => setPhase({ step: 'input' })}
          className="fixed right-5 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 grid h-14 w-14 place-items-center rounded-full bg-sage text-white shadow-[0_8px_20px_-6px_rgba(45,90,67,0.55)] transition-transform active:scale-95">
          <Plus size={26} strokeWidth={2.4} />
        </button>
        {fileInput}
        {sheet}
        <Toast text={toast} />
      </>
    )
  }

  return (
    <>
      <form onSubmit={submitBar} className="flex h-12 w-full items-center gap-1 rounded-full border border-line bg-card pl-4 pr-1.5 shadow-[var(--shadow-card)] focus-within:border-sage">
        <Sparkles size={17} className="shrink-0 text-wisteria" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('quick.barPlaceholder')} aria-label={t('quick.title')}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-[15px] text-ink outline-none placeholder:text-ink-3" />
        <VoiceButton size="sm" onText={appendVoice} onStatus={onVoiceStatus} />
        <IconButton type="button" label={t('quick.fromFile')} onClick={pickFile} className="h-9 w-9"><Camera size={18} /></IconButton>
        <button type="submit" aria-label={t('quick.submit')} title={t('quick.submit')} disabled={!text.trim()}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sage text-white transition-opacity disabled:opacity-30">
          <ArrowUp size={18} strokeWidth={2.4} />
        </button>
      </form>
      {voiceLine && <div className="mt-1.5 px-4">{voiceLine}</div>}
      {fileInput}
      {sheet}
      <Toast text={toast} />
    </>
  )
}
