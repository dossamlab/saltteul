import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { Minus, Package, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { daysToExpiry, expiresSoon, isLow, qtyLabel, sortPantry } from '../../shared/pantry'
import type { PantryItem, PantryLog } from '../../shared/types'
import { t } from '../copy'
import { addPantryItem, changePantryQty, deletePantryItem, updatePantryItem, type PantryDraft } from '../data/actions'
import { useHousehold } from '../data/store'
import { db } from '../firebase'
import { formatDay } from '../format'
import { Button, Card, CardHeader, Empty, Field, IconButton, Pill, Sheet } from './ui'

const toInt = (s: string) => Math.max(0, Math.round(Number(s) || 0))
const splitNames = (s: string) => [...new Set(s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean))]

function ExpiryPill({ p, today }: { p: PantryItem; today: string }) {
  const d = daysToExpiry(p, today)
  if (d === null || !expiresSoon(p, today)) return null
  return <Pill tone="terra">{d < 0 ? t('pantry.expired') : t('pantry.expirySoon', { days: d })}</Pill>
}

function PantryRow({ p, onEdit, onSet }: { p: PantryItem; onEdit: () => void; onSet: () => void }) {
  const h = useHousehold()
  const low = isLow(p)
  return (
    <div className="flex items-center gap-2 py-2.5">
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <p className="truncate text-[15px] text-ink">{p.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-ink-2">
          {low && <Pill tone="terra">{t('pantry.low')}</Pill>}
          <ExpiryPill p={p} today={h.today} />
          {p.expiry && !expiresSoon(p, h.today) && <span>{t('pantry.expiry', { date: formatDay(p.expiry) })}</span>}
        </div>
      </button>
      <IconButton label={t('pantry.minus')} disabled={p.qty <= 0} onClick={() => changePantryQty(h.hid, h.uid, p, 'use', 1)} className="h-9 w-9 bg-muted">
        <Minus size={16} />
      </IconButton>
      <button type="button" onClick={onSet} aria-label={t('pantry.setQty')}
        className={`min-w-[3.5rem] rounded-full px-2 py-1.5 text-center text-[15px] font-semibold ${low ? 'bg-peach-soft text-terra-2' : 'text-ink'}`}>
        {qtyLabel(p)}
      </button>
      <IconButton label={t('pantry.plus')} onClick={() => changePantryQty(h.hid, h.uid, p, 'add', 1)} className="h-9 w-9 bg-muted">
        <Plus size={16} />
      </IconButton>
    </div>
  )
}

function SetQtySheet({ item, onClose }: { item: PantryItem | null; onClose: () => void }) {
  const h = useHousehold()
  const [value, setValue] = useState('')
  const [key, setKey] = useState<string | null>(null)
  if ((item?.id ?? null) !== key) {
    setKey(item?.id ?? null)
    setValue(item ? String(item.qty) : '')
  }
  const save = async () => {
    if (!item) return
    await changePantryQty(h.hid, h.uid, item, 'set', toInt(value))
    onClose()
  }
  return (
    <Sheet open={!!item} onClose={onClose} title={item ? t('pantry.setTitle', { name: item.name }) : ''}>
      <div className="flex flex-col gap-4">
        <Field label={`${t('pantry.qty')} (${item?.unit || '개'})`} type="number" inputMode="numeric" min={0} value={value} autoFocus
          onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        <Button onClick={save}>{t('action.save')}</Button>
      </div>
    </Sheet>
  )
}

function RecentLog({ item }: { item: PantryItem }) {
  const h = useHousehold()
  const [logs, setLogs] = useState<PantryLog[]>([])
  useEffect(() => {
    const q = query(collection(db, `households/${h.hid}/pantryLog`), where('itemId', '==', item.id), orderBy('at', 'desc'), limit(5))
    return onSnapshot(q, (s) => setLogs(s.docs.map((d) => ({ ...(d.data() as PantryLog), id: d.id }))), () => setLogs([]))
  }, [h.hid, item.id])
  if (!logs.length) return null
  return (
    <div className="rounded-[var(--radius-field)] bg-muted px-3.5 py-3 text-[13px]">
      <p className="mb-1 font-semibold text-ink-2">{t('pantry.history')}</p>
      {logs.map((l) => (
        <p key={l.id} className="leading-relaxed text-ink">
          <span className="mr-2 text-ink-2">{new Date(l.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          {t(`pantry.log.${l.op}`, { who: l.by ? h.nameOf(l.by) : '', n: `${l.op === 'set' ? l.after : l.amount}${item.unit || '개'}` })}
        </p>
      ))}
    </div>
  )
}

const EMPTY_DRAFT = { name: '', unit: '개', qty: '0', minQty: '1', restockQty: '0', expiry: '', aliases: '' }

function EditSheet({ editing, onClose }: { editing: PantryItem | 'new' | null; onClose: () => void }) {
  const h = useHousehold()
  const cur = editing && editing !== 'new' ? editing : null
  const [f, setF] = useState(EMPTY_DRAFT)
  const [key, setKey] = useState<string | null>(null)
  const k = editing === null ? null : cur?.id ?? 'new'
  if (k !== key) {
    setKey(k)
    setF(cur
      ? { name: cur.name, unit: cur.unit, qty: String(cur.qty), minQty: String(cur.minQty), restockQty: String(cur.restockQty), expiry: cur.expiry ?? '', aliases: (cur.aliases ?? []).join(', ') }
      : EMPTY_DRAFT)
  }
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })
  const ok = !!f.name.trim()
  const save = async () => {
    if (!ok) return
    const draft: PantryDraft = {
      name: f.name.trim(), unit: f.unit.trim() || '개', qty: toInt(f.qty), minQty: toInt(f.minQty), restockQty: toInt(f.restockQty),
      expiry: f.expiry || null, aliases: splitNames(f.aliases),
    }
    if (cur) {
      // A count typed here goes through the log like any other change.
      const { qty, ...rest } = draft
      await updatePantryItem(h.hid, h.uid, cur.id, rest)
      if (qty !== cur.qty) await changePantryQty(h.hid, h.uid, { ...cur, ...rest }, 'set', qty)
    } else {
      await addPantryItem(h.hid, h.uid, draft)
    }
    onClose()
  }
  return (
    <Sheet open={editing !== null} onClose={onClose} title={cur ? t('pantry.editTitle') : t('pantry.addTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('pantry.name')} value={f.name} placeholder={t('pantry.namePlaceholder')} onChange={(e) => set({ name: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('pantry.qty')} type="number" inputMode="numeric" min={0} value={f.qty} onChange={(e) => set({ qty: e.target.value })} />
          <Field label={t('pantry.unit')} value={f.unit} placeholder={t('pantry.unitPlaceholder')} onChange={(e) => set({ unit: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('pantry.minQty')} type="number" inputMode="numeric" min={0} value={f.minQty} onChange={(e) => set({ minQty: e.target.value })} />
          <Field label={t('pantry.restockQty')} type="number" inputMode="numeric" min={0} value={f.restockQty} onChange={(e) => set({ restockQty: e.target.value })} />
        </div>
        <p className="-mt-2 text-[12px] text-ink-2">{t('pantry.minQtyHint')} {t('pantry.restockHint')}</p>
        <Field label={t('pantry.expiryField')} type="date" value={f.expiry} onChange={(e) => set({ expiry: e.target.value })} />
        <Field label={t('pantry.aliases')} value={f.aliases} placeholder={t('pantry.aliasesPlaceholder')} onChange={(e) => set({ aliases: e.target.value })} />
        {cur && <RecentLog item={cur} />}
        <div className="flex gap-2">
          {cur && (
            <Button variant="soft" aria-label={t('action.delete')} onClick={async () => { await deletePantryItem(h.hid, cur.id); onClose() }}>
              <Trash2 size={18} />
            </Button>
          )}
          <Button className="flex-1" disabled={!ok} onClick={save}>{t('action.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

/** 「우리 집」 pantry: what the house should always have, with −1 / +1, the count to tap and fix, and the edit sheet. */
export function PantrySection() {
  const h = useHousehold()
  const [editing, setEditing] = useState<PantryItem | 'new' | null>(null)
  const [setting, setSetting] = useState<PantryItem | null>(null)
  const list = sortPantry(h.pantry, h.today)
  return (
    <Card>
      <CardHeader title={t('pantry.title')} icon={<Package size={18} className="text-sage" />}
        action={<IconButton label={t('pantry.add')} onClick={() => setEditing('new')}><Plus size={18} /></IconButton>} />
      <p className="-mt-2 mb-1 text-[12px] text-ink-2">{t('pantry.hint')}</p>
      {list.length === 0 && <Empty>{t('pantry.empty')}</Empty>}
      <div className="divide-y divide-line">
        {list.map((p) => <PantryRow key={p.id} p={p} onEdit={() => setEditing(p)} onSet={() => setSetting(p)} />)}
      </div>
      <EditSheet editing={editing} onClose={() => setEditing(null)} />
      <SetQtySheet item={setting} onClose={() => setSetting(null)} />
    </Card>
  )
}
