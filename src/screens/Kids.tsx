import { ChevronDown, Share2, Sprout } from 'lucide-react'
import { useState } from 'react'
import type { JournalEntry } from '../../shared/types'
import { DinnerCard, KidsnoteCard } from '../components/HomeCards'
import { MenuSection } from '../components/MenuSection'
import { Button, Card, CardHeader, Empty } from '../components/ui'
import { t } from '../copy'
import { journalShareText } from '../data/pure'
import { useHousehold } from '../data/store'
import { formatDay } from '../format'

function JournalEntryView({ entry, open, onToggle }: { entry: JournalEntry; open: boolean; onToggle: () => void }) {
  const [msg, setMsg] = useState('')
  const range = t('journal.range', { from: formatDay(entry.weekStart), to: formatDay(entry.weekEnd) })
  const share = async () => {
    const text = journalShareText(entry.title, range, entry.lines)
    setMsg('')
    if (navigator.share) {
      try {
        await navigator.share({ title: entry.title, text })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      setMsg(t('journal.copied'))
    } catch {
      setMsg(t('journal.copyFailed'))
    }
  }
  return (
    <div className="py-3">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 text-left">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-wisteria">{range}</p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{entry.title}</p>
        </div>
        <ChevronDown size={18} className={`mt-1 shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <ul className="mt-2 flex flex-col gap-1.5">
            {entry.lines.map((l, i) => (
              <li key={i} className="flex gap-2 text-[14px] leading-relaxed text-ink">
                <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-wisteria" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex-1 text-[12px] text-ink-2">{t('journal.fromReports', { n: entry.reportCount })}</span>
            {msg && <span role="status" className="text-[12px] font-semibold text-sage">{msg}</span>}
            <Button variant="soft" className="h-9 px-3.5 text-[13px]" onClick={share}>
              <Share2 size={15} />
              {t('journal.share')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

/** Weekly growth journal written from the week's Kids Note notices (newest first, the latest one opened). */
function JournalSection() {
  const h = useHousehold()
  const [openId, setOpenId] = useState<string | null | undefined>(undefined)
  const child = h.journal.find((j) => j.childName.trim())?.childName.trim()
  const current = openId === undefined ? h.journal[0]?.id ?? null : openId
  return (
    <Card>
      <CardHeader title={child ? t('journal.title', { name: child }) : t('journal.titleGeneric')}
        icon={<span className="grid h-7 w-7 place-items-center rounded-full bg-lavender/60 text-wisteria"><Sprout size={15} /></span>} />
      {h.journal.length === 0 && <Empty>{t('journal.empty')}</Empty>}
      <div className="-mt-1 divide-y divide-line">
        {h.journal.map((j) => (
          <JournalEntryView key={j.id} entry={j} open={current === j.id} onToggle={() => setOpenId(current === j.id ? null : j.id)} />
        ))}
      </div>
    </Card>
  )
}

/** Everything about the child in one tab: Kids Note events, today's daycare meals, the weekly journal, the menu sheet. */
export function KidsScreen({ wide = false }: { wide?: boolean }) {
  if (wide) {
    return (
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 items-start gap-5">
        <div className="flex flex-col gap-5">
          <KidsnoteCard />
          <DinnerCard />
          <MenuSection />
        </div>
        <JournalSection />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <KidsnoteCard />
      <DinnerCard />
      <JournalSection />
      <MenuSection />
    </div>
  )
}
