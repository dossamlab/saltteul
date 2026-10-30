import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ChevronDown, ExternalLink, History, Loader2, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../copy'
import { undoKidsnoteBatch } from '../data/actions'
import { canUndo, foundItems, recordStatus, recordTitle, type KidsnoteRecord, type RecordStatus } from '../data/kidsnoteHistory'
import { useHousehold } from '../data/store'
import { db } from '../firebase'
import { formatDay } from '../format'
import { Button, Empty, Pill, Sheet } from './ui'

const SHOWN = 40

function statusText(s: RecordStatus): string {
  switch (s.kind) {
    case 'added':
      return s.checks
        ? t('kidsnote.history.addedWithCheck', { events: s.events, items: s.items, checks: s.checks })
        : t('kidsnote.history.added', { events: s.events, items: s.items })
    case 'nothing': return t('kidsnote.history.nothing')
    case 'otherClass': return t('kidsnote.history.otherClass')
    case 'undone': return t('kidsnote.history.undone')
  }
}

function RecordRow({ r, open, onToggle }: { r: KidsnoteRecord; open: boolean; onToggle: () => void }) {
  const [undo, setUndo] = useState<'idle' | 'busy' | 'error'>('idle')
  const status = recordStatus(r)
  const found = foundItems(r)
  const notes = r.extraction?.notes ?? []
  const runUndo = async () => {
    if (!r.batchId) return
    setUndo('busy')
    try {
      await undoKidsnoteBatch(r.batchId)
      setUndo('idle')
    } catch {
      setUndo('error')
    }
  }
  return (
    <div className="py-3">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12px] text-ink-2">
            <Pill tone={r.kind === 'notice' ? 'ai' : 'sage'}>{t(r.kind === 'notice' ? 'kidsnote.kind.notice' : 'kidsnote.kind.report')}</Pill>
            <span>{formatDay(r.written)}</span>
          </div>
          <p className="mt-1 truncate text-[15px] text-ink">{recordTitle(r) || t('kidsnote.history.noText')}</p>
          <p className={`mt-0.5 text-[13px] ${status.kind === 'added' ? 'text-sage' : 'text-ink-2'}`}>{statusText(status)}</p>
        </div>
        <ChevronDown size={18} className={`mt-1 shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 rounded-[var(--radius-field)] bg-muted px-3.5 py-3 text-[13px]">
          {found.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-ink-2">{t('kidsnote.history.found')}</p>
              {found.map((f, i) => (
                <p key={i} className="leading-relaxed text-ink">
                  <span className="mr-2 text-wisteria">{/^\d{4}-\d{2}-\d{2}$/.test(f.when) ? formatDay(f.when) : f.when || t('kidsnote.history.noDate')}</span>
                  {f.title}
                </p>
              ))}
            </div>
          )}
          {notes.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-ink-2">{t('kidsnote.history.notes')}</p>
              {notes.map((n, i) => <p key={i} className="leading-relaxed text-ink">{n}</p>)}
            </div>
          )}
          {!found.length && !notes.length && <p className="text-ink-2">{t('kidsnote.history.nothingFound')}</p>}
          <div className="mt-1 flex flex-wrap gap-2">
            {r.url && (
              <a href={r.url} target="_blank" rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-semibold text-ink-2">
                <ExternalLink size={14} />{t('kidsnote.history.open')}
              </a>
            )}
            {canUndo(r) && (
              <button type="button" disabled={undo === 'busy'} onClick={runUndo}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-semibold text-terra-2 disabled:opacity-60">
                {undo === 'busy' ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}{t('kidsnote.undoLast')}
              </button>
            )}
          </div>
          {undo === 'error' && <p role="alert" className="text-terra-2">{t('kidsnote.history.undoFailed')}</p>}
        </div>
      )}
    </div>
  )
}

/** What the server did with each Kids Note report and notice, newest first, with undo. */
export function KidsnoteHistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const h = useHousehold()
  const [records, setRecords] = useState<KidsnoteRecord[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const q = query(collection(db, `households/${h.hid}/kidsnote`), orderBy('processedAt', 'desc'), limit(SHOWN))
    return onSnapshot(q, (snap) => setRecords(snap.docs.map((d) => ({ ...(d.data() as KidsnoteRecord), id: d.id }))), () => setRecords([]))
  }, [open, h.hid])

  return (
    <Sheet open={open} onClose={onClose} title={t('kidsnote.historyTitle')}>
      <p className="-mt-2 mb-2 text-[13px] text-ink-2">{t('kidsnote.historyHint')}</p>
      {records === null && <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-wisteria" /></div>}
      {records?.length === 0 && <Empty>{t('kidsnote.historyEmpty')}</Empty>}
      <div className="divide-y divide-line">
        {records?.map((r) => (
          <RecordRow key={r.id} r={r} open={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)} />
        ))}
      </div>
    </Sheet>
  )
}

/** Small header button that opens the history sheet. */
export function KidsnoteHistoryButton({ variant = 'link' }: { variant?: 'link' | 'soft' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {variant === 'soft'
        ? <Button variant="soft" onClick={() => setOpen(true)}><History size={18} />{t('kidsnote.historyOpen')}</Button>
        : (
          <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 text-[12px] font-semibold text-ink-2">
            <History size={14} />{t('kidsnote.historyOpen')}
          </button>
        )}
      <KidsnoteHistorySheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
