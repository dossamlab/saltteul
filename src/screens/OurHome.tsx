import { Cake, ChevronDown, ChevronRight, Heart, Pencil, Plus, Settings2, Share2, Sprout, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { nextOccurrence, togetherDays } from '../../shared/anniversaries'
import { effectiveCycle, nextDue } from '../../shared/consumables'
import { diffDays } from '../../shared/householdDate'
import type { Anniversary, AnniversaryKind, Consumable, JournalEntry, PrepRule } from '../../shared/types'
import { journalShareText } from '../data/pure'
import { MenuSection } from '../components/MenuSection'
import { PantrySection } from '../components/PantrySection'
import { Button, Card, CardHeader, Empty, Field, IconButton, Pill, Segmented, Sheet } from '../components/ui'
import { t } from '../copy'
import {
  addAnniversary, addConsumable, addPrepRule, deleteAnniversary, deleteConsumable, deletePrepRule, updateAnniversary,
  updateConsumable, updatePrepRule,
} from '../data/actions'
import { useHousehold } from '../data/store'
import { dDayLabel, formatDay } from '../format'

function AnniversarySection() {
  const h = useHousehold()
  const [editing, setEditing] = useState<Anniversary | 'new' | null>(null)
  const sorted = [...h.anniversaries].sort((a, b) =>
    diffDays(h.today, nextOccurrence(a.date, h.today)) - diffDays(h.today, nextOccurrence(b.date, h.today)))
  return (
    <Card>
      <CardHeader title={t('anniv.title')} icon={<Heart size={18} className="text-terra" />} action={
        <IconButton label={t('anniv.add')} onClick={() => setEditing('new')}><Plus size={18} /></IconButton>
      } />
      {sorted.length === 0 && <Empty>{t('anniv.empty')}</Empty>}
      {sorted.map((a) => {
        const next = nextOccurrence(a.date, h.today)
        return (
          <button key={a.id} type="button" onClick={() => setEditing(a)} className="flex w-full items-center gap-3 py-2.5 text-left">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-peach-soft text-terra">
              {a.kind === 'birthday' ? <Cake size={17} /> : <Heart size={17} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">{a.title}</p>
              <p className="text-[12px] text-ink-2">
                {a.kind === 'together'
                  ? t('anniv.togetherDays', { n: togetherDays(a.date, h.today) })
                  : `${formatDay(next)} · ${t(`anniv.kind.${a.kind}`)}`}
              </p>
            </div>
            {a.kind !== 'together' && <Pill tone="terra">{dDayLabel(diffDays(h.today, next))}</Pill>}
          </button>
        )
      })}
      <AnniversarySheet editing={editing} onClose={() => setEditing(null)} />
    </Card>
  )
}

function AnniversarySheet({ editing, onClose }: { editing: Anniversary | 'new' | null; onClose: () => void }) {
  const h = useHousehold()
  const cur = editing && editing !== 'new' ? editing : null
  const [form, setForm] = useState<{ kind: AnniversaryKind; title: string; date: string; person: string }>({ kind: 'birthday', title: '', date: '', person: '' })
  const [key, setKey] = useState<string | null>(null)
  const k = editing === null ? null : cur?.id ?? 'new'
  if (k !== key) {
    setKey(k)
    setForm({ kind: cur?.kind ?? 'birthday', title: cur?.title ?? '', date: cur?.date ?? '', person: cur?.person ?? '' })
  }
  const ok = form.title.trim() && form.date
  const save = async () => {
    if (!ok) return
    const data = { kind: form.kind, title: form.title.trim(), date: form.date, person: form.person.trim() || undefined }
    if (cur) await updateAnniversary(h.hid, cur.id, data)
    else await addAnniversary(h.hid, { ...data, remindDays: [7, 1] })
    onClose()
  }
  const kinds: AnniversaryKind[] = ['together', 'wedding', 'birthday', 'other']
  return (
    <Sheet open={editing !== null} onClose={onClose} title={cur ? t('anniv.editTitle') : t('anniv.addTitle')}>
      <div className="flex flex-col gap-4">
        <Segmented value={form.kind} onChange={(kind) => setForm({ ...form, kind })} options={kinds.map((x) => ({ value: x, label: t(`anniv.kind.${x}`) }))} />
        <Field label={t('field.title')} value={form.title} placeholder={t(`anniv.placeholder.${form.kind}`)} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Field label={form.kind === 'together' ? t('anniv.startDate') : t('field.date')} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        {form.kind === 'birthday' && <Field label={t('anniv.person')} value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} />}
        <p className="text-[12px] text-ink-2">{form.kind === 'together' ? t('anniv.togetherHint') : t('anniv.remindHint')}</p>
        <div className="flex gap-2">
          {cur && <Button variant="soft" aria-label={t('action.delete')} onClick={async () => { await deleteAnniversary(h.hid, cur.id); onClose() }}><Trash2 size={18} /></Button>}
          <Button className="flex-1" disabled={!ok} onClick={save}>{t('action.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

function ConsumableSection() {
  const h = useHousehold()
  const [editing, setEditing] = useState<Consumable | 'new' | null>(null)
  return (
    <Card>
      <CardHeader title={t('cons.title')} action={<IconButton label={t('cons.add')} onClick={() => setEditing('new')}><Plus size={18} /></IconButton>} />
      <p className="-mt-2 mb-1 text-[12px] text-ink-2">{t('cons.hint')}</p>
      {h.consumables.length === 0 && <Empty>{t('cons.empty')}</Empty>}
      {h.consumables.map((c) => {
        const due = nextDue(c)
        const left = due ? diffDays(h.today, due) : null
        return (
          <button key={c.id} type="button" onClick={() => setEditing(c)} className="flex w-full items-center gap-3 py-2.5 text-left">
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">{c.name}</p>
              <p className="text-[12px] text-ink-2">
                {t('cons.cycle', { n: effectiveCycle(c) })}
                {c.purchases.length >= 3 && ` · ${t('cons.learned')}`}
              </p>
            </div>
            {left === null ? <Pill>{t('cons.noPurchase')}</Pill>
              : <Pill tone={left <= 5 ? 'terra' : 'muted'}>{left < 0 ? t('cons.overdue', { n: -left }) : t('cons.left', { n: left })}</Pill>}
          </button>
        )
      })}
      <ConsumableSheet editing={editing} onClose={() => setEditing(null)} />
    </Card>
  )
}

function ConsumableSheet({ editing, onClose }: { editing: Consumable | 'new' | null; onClose: () => void }) {
  const h = useHousehold()
  const cur = editing && editing !== 'new' ? editing : null
  const [name, setName] = useState('')
  const [cycle, setCycle] = useState('30')
  const [last, setLast] = useState('')
  const [key, setKey] = useState<string | null>(null)
  const k = editing === null ? null : cur?.id ?? 'new'
  if (k !== key) {
    setKey(k)
    setName(cur?.name ?? '')
    setCycle(String(cur?.initialCycleDays ?? 30))
    setLast(cur?.purchases.at(-1) ?? '')
  }
  const days = Math.max(1, Math.round(Number(cycle) || 0))
  const save = async () => {
    if (!name.trim()) return
    if (cur) {
      const purchases = last && !cur.purchases.includes(last) ? [...cur.purchases, last].sort() : cur.purchases
      await updateConsumable(h.hid, cur.id, { name: name.trim(), initialCycleDays: days, purchases })
    } else {
      await addConsumable(h.hid, { name: name.trim(), initialCycleDays: days, purchases: last ? [last] : [] })
    }
    onClose()
  }
  return (
    <Sheet open={editing !== null} onClose={onClose} title={cur ? t('cons.editTitle') : t('cons.addTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('field.item')} value={name} placeholder={t('cons.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        <Field label={t('cons.cycleLabel')} type="number" inputMode="numeric" min={1} value={cycle} onChange={(e) => setCycle(e.target.value)} />
        <Field label={t('cons.lastLabel')} type="date" value={last} onChange={(e) => setLast(e.target.value)} />
        {cur && cur.purchases.length > 0 && (
          <p className="text-[12px] text-ink-2">{t('cons.history', { list: cur.purchases.slice(-5).map((p) => p.slice(5).replace('-', '/')).join(', ') })}</p>
        )}
        <div className="flex gap-2">
          {cur && <Button variant="soft" aria-label={t('action.delete')} onClick={async () => { await deleteConsumable(h.hid, cur.id); onClose() }}><Trash2 size={18} /></Button>}
          <Button className="flex-1" disabled={!name.trim()} onClick={save}>{t('action.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

function PrepRuleSection() {
  const h = useHousehold()
  const [editing, setEditing] = useState<PrepRule | 'new' | null>(null)
  return (
    <Card>
      <CardHeader title={t('prep.title')} action={<IconButton label={t('prep.add')} onClick={() => setEditing('new')}><Plus size={18} /></IconButton>} />
      <p className="-mt-2 mb-1 text-[12px] text-ink-2">{t('prep.hint')}</p>
      {h.prepRules.length === 0 && <Empty>{t('prep.empty')}</Empty>}
      {h.prepRules.map((r) => (
        <div key={r.id} className="flex items-center gap-3 py-2.5">
          <span className="w-20 shrink-0 text-[15px] font-semibold">{r.keyword}</span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">{r.items.map((i) => <Pill key={i} tone="sage">{i}</Pill>)}</div>
          <IconButton label={t('action.edit')} onClick={() => setEditing(r)}><Pencil size={16} /></IconButton>
        </div>
      ))}
      <PrepRuleSheet editing={editing} onClose={() => setEditing(null)} />
    </Card>
  )
}

function PrepRuleSheet({ editing, onClose }: { editing: PrepRule | 'new' | null; onClose: () => void }) {
  const h = useHousehold()
  const cur = editing && editing !== 'new' ? editing : null
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState('')
  const [key, setKey] = useState<string | null>(null)
  const k = editing === null ? null : cur?.id ?? 'new'
  if (k !== key) {
    setKey(k)
    setKeyword(cur?.keyword ?? '')
    setItems(cur?.items.join(', ') ?? '')
  }
  const list = items.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
  const ok = keyword.trim() && list.length
  const save = async () => {
    if (!ok) return
    if (cur) await updatePrepRule(h.hid, cur.id, { keyword: keyword.trim(), items: list })
    else await addPrepRule(h.hid, { keyword: keyword.trim(), items: list })
    onClose()
  }
  return (
    <Sheet open={editing !== null} onClose={onClose} title={cur ? t('prep.editTitle') : t('prep.addTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('prep.keyword')} value={keyword} placeholder={t('prep.keywordPlaceholder')} onChange={(e) => setKeyword(e.target.value)} />
        <Field label={t('prep.items')} value={items} placeholder={t('prep.itemsPlaceholder')} onChange={(e) => setItems(e.target.value)} />
        <div className="flex gap-2">
          {cur && <Button variant="soft" aria-label={t('action.delete')} onClick={async () => { await deletePrepRule(h.hid, cur.id); onClose() }}><Trash2 size={18} /></Button>}
          <Button className="flex-1" disabled={!ok} onClick={save}>{t('action.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

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

function SettingsLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-card p-5 text-left shadow-[var(--shadow-card)]">
      <Settings2 size={20} className="text-sage" />
      <span className="flex-1 text-[16px] font-semibold">{t('settings.title')}</span>
      <ChevronRight size={18} className="text-ink-3" />
    </button>
  )
}

export function OurHomeScreen({ openSettings, wide = false }: { openSettings: () => void; wide?: boolean }) {
  if (wide) {
    // PC: two columns of cards; settings is in the sidebar, so no extra link here.
    return (
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 items-start gap-5">
        <div className="flex flex-col gap-5">
          <JournalSection />
          <AnniversarySection />
        </div>
        <div className="flex flex-col gap-5">
          <PantrySection />
          <MenuSection />
          <ConsumableSection />
          <PrepRuleSection />
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <AnniversarySection />
      <PantrySection />
      <JournalSection />
      <MenuSection />
      <ConsumableSection />
      <PrepRuleSection />
      <SettingsLink onClick={openSettings} />
    </div>
  )
}
