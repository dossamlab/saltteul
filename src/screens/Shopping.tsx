import { BellRing, Package, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { dueSoon } from '../../shared/consumables'
import { isLow, qtyLabel, sortPantry } from '../../shared/pantry'
import type { ShoppingItem } from '../../shared/types'
import { NudgeSheet } from '../components/TodoParts'
import { Button, Card, CardHeader, Checkbox, Empty, Field, IconButton, Pill, Sheet } from '../components/ui'
import { t } from '../copy'
import { addConsumableToShopping, addPantryToShopping, addShopping, clearBought, deleteShopping, toggleShopping, updateShopping } from '../data/actions'
import { useHousehold } from '../data/store'

/** Pantry items at or below their minimum that are not on the list yet. */
function PantrySuggestions() {
  const h = useHousehold()
  const inList = new Set(h.shopping.filter((s) => !s.bought).map((s) => s.pantryId).filter(Boolean))
  const low = sortPantry(h.pantry, h.today).filter((p) => isLow(p) && !inList.has(p.id))
  if (!low.length) return null
  return (
    <Card>
      <CardHeader title={t('pantry.suggestTitle')} icon={<Package size={16} className="text-terra" />} />
      {low.map((p) => (
        <div key={p.id} className="flex items-center gap-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[15px]">{p.name}</p>
            <p className="text-[12px] text-terra-2">{t('pantry.suggestLine', { name: p.name, qty: qtyLabel(p) })}</p>
          </div>
          <Button variant="soft" className="h-9 px-3.5 text-[13px]" onClick={() => addPantryToShopping(h.hid, h.uid, p)}>
            {t('pantry.addToShopping')}
          </Button>
        </div>
      ))}
    </Card>
  )
}

export function ShoppingSuggestions() {
  return (
    <>
      <PantrySuggestions />
      <ConsumableSuggestions />
    </>
  )
}

function ConsumableSuggestions() {
  const h = useHousehold()
  const inList = new Set(h.shopping.filter((s) => !s.bought).map((s) => s.consumableId).filter(Boolean))
  const due = dueSoon(h.consumables, h.today, 5).filter((c) => !inList.has(c.id))
  if (!due.length) return null
  return (
    <Card ai>
      <CardHeader title={t('shop.suggestTitle')} icon={<Sparkles size={16} className="text-wisteria" />} />
      {due.map((c) => (
        <div key={c.id} className="flex items-center gap-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[15px]">{c.name}</p>
            <p className="text-[12px] text-ink-2">
              {c.daysLeft > 0 ? t('shop.suggestDays', { n: c.daysLeft }) : t('shop.suggestNow')}
            </p>
          </div>
          <Button variant="soft" className="h-9 px-3.5 text-[13px]" onClick={() => addConsumableToShopping(h.hid, h.uid, c)}>
            {t('shop.suggestAdd')}
          </Button>
        </div>
      ))}
    </Card>
  )
}

function ShoppingRow({ item, onEdit, onNudge }: { item: ShoppingItem; onEdit: () => void; onNudge: () => void }) {
  const h = useHousehold()
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="pt-0.5">
        <Checkbox checked={item.bought} label={item.name} onChange={() => toggleShopping(h.hid, item, h.uid, h.today, h.consumables, h.pantry)} />
      </div>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onEdit}>
        <p className={`text-[15px] ${item.bought ? 'done-text' : ''}`}>
          {item.name}
          {item.qty && <span className="ml-1.5 text-[13px] text-ink-2">{item.qty}</span>}
        </p>
        {item.note && <p className="mt-0.5 text-[13px] text-ink-2">{item.note}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
          {item.bought && item.boughtBy
            ? <span>{t('shop.boughtBy', { name: h.nameOf(item.boughtBy) })}</span>
            : <span>{t('shop.addedBy', { name: h.nameOf(item.addedBy) })}</span>}
          {item.source === 'kidsnote' && <Pill tone="ai">{t('badge.kidsnote')}</Pill>}
          {item.source === 'consumable' && <Pill tone="ai">{t('badge.cycle')}</Pill>}
        </div>
      </button>
      {!item.bought && (
        <IconButton label={t('nudge.button', { name: h.partner?.displayName || t('owner.partner') })} onClick={onNudge}>
          <BellRing size={18} />
        </IconButton>
      )}
    </div>
  )
}

function EditSheet({ item, onClose }: { item: ShoppingItem | null; onClose: () => void }) {
  const h = useHousehold()
  const [form, setForm] = useState({ name: '', qty: '', note: '' })
  const [key, setKey] = useState<string | null>(null)
  if ((item?.id ?? null) !== key) {
    setKey(item?.id ?? null)
    setForm({ name: item?.name ?? '', qty: item?.qty ?? '', note: item?.note ?? '' })
  }
  if (!item) return null
  return (
    <Sheet open onClose={onClose} title={t('shop.editTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('field.item')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field label={t('field.qty')} value={form.qty} placeholder={t('shop.qtyPlaceholder')} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        <Field label={t('field.note')} value={form.note} placeholder={t('shop.notePlaceholder')} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <div className="flex gap-2">
          <Button variant="soft" aria-label={t('action.delete')} onClick={async () => { await deleteShopping(h.hid, item.id); onClose() }}>
            <Trash2 size={18} />
          </Button>
          <Button className="flex-1" disabled={!form.name.trim()} onClick={async () => {
            await updateShopping(h.hid, item.id, { name: form.name.trim(), qty: form.qty.trim(), note: form.note.trim() })
            onClose()
          }}>{t('action.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

export function QuickAdd() {
  const h = useHousehold()
  const [name, setName] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await addShopping(h.hid, h.uid, name)
    setName('')
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('shop.quickPlaceholder')} aria-label={t('shop.quickPlaceholder')}
        className="h-12 min-w-0 flex-1 rounded-full border border-sand bg-white px-4 text-[15px] outline-none placeholder:text-ink-3 focus:border-sage" />
      <Button type="submit" className="w-12 px-0" aria-label={t('action.add')} disabled={!name.trim()}>
        <Plus size={20} />
      </Button>
    </form>
  )
}

/** part: 'all' = open list and bought list; 'open' / 'bought' = just one of them (PC puts them in different columns). */
export function ShoppingList({ part = 'all' }: { part?: 'all' | 'open' | 'bought' }) {
  const h = useHousehold()
  const [editing, setEditing] = useState<ShoppingItem | null>(null)
  const [nudge, setNudge] = useState<ShoppingItem | null>(null)
  const open = h.shopping.filter((s) => !s.bought).sort((a, b) => b.createdAt - a.createdAt)
  const bought = h.shopping.filter((s) => s.bought).sort((a, b) => (b.boughtAt ?? 0) - (a.boughtAt ?? 0))
  return (
    <>
      {part !== 'bought' && (
        <Card>
          <CardHeader title={t('shop.listTitle')} action={<span className="text-[12px] text-ink-2">{t('shop.countLeft', { n: open.length })}</span>} />
          {open.length === 0 && <Empty>{t('shop.empty')}</Empty>}
          <div className="divide-y divide-line">
            {open.map((s) => <ShoppingRow key={s.id} item={s} onEdit={() => setEditing(s)} onNudge={() => setNudge(s)} />)}
          </div>
        </Card>
      )}
      {part !== 'open' && (bought.length > 0 || part === 'bought') && (
        <Card>
          <CardHeader title={t('shop.boughtTitle')} action={bought.length > 0 && (
            <button type="button" className="text-[12px] font-semibold text-ink-2" onClick={() => clearBought(h.hid, bought)}>{t('shop.clearBought')}</button>
          )} />
          {bought.length === 0 && <Empty>{t('shop.boughtEmpty')}</Empty>}
          <div className="divide-y divide-line">
            {bought.map((s) => <ShoppingRow key={s.id} item={s} onEdit={() => setEditing(s)} onNudge={() => setNudge(s)} />)}
          </div>
        </Card>
      )}
      <EditSheet item={editing} onClose={() => setEditing(null)} />
      <NudgeSheet target={nudge && { type: 'shopping', id: nudge.id, title: nudge.name }} onClose={() => setNudge(null)} />
    </>
  )
}

export function ShoppingScreen({ wide = false }: { wide?: boolean }) {
  if (wide) {
    // PC: list on the left (2/3), suggestions and bought items on the right (1/3).
    return (
      <div className="mx-auto grid max-w-[1200px] grid-cols-3 items-start gap-5">
        <div className="col-span-2 flex flex-col gap-4">
          <QuickAdd />
          <ShoppingList part="open" />
        </div>
        <div className="flex flex-col gap-4">
          <ShoppingSuggestions />
          <ShoppingList part="bought" />
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <QuickAdd />
      <ShoppingSuggestions />
      <ShoppingList />
    </div>
  )
}
