import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { OTHER_CATEGORY, PACK_TABS, groupByCategory, nextOrder } from '../../shared/packing'
import type { PackRuleKind, PackTab, PackingBaseItem } from '../../shared/types'
import { CategoryPicker, QtyStepper, ruleLabel, tabLabel } from '../components/TripParts'
import { Button, Card, CardHeader, Checkbox, Empty, Field, IconButton, Segmented, Sheet, useNotice } from '../components/ui'
import { t } from '../copy'
import { addBaseItem, deleteBaseItem, ensurePackingBase, restoreBaseItem, updateBaseItem, type BaseDraft } from '../data/actions'
import { useHousehold } from '../data/store'

type Draft = Omit<BaseDraft, 'order'>

const emptyDraft = (tab: PackTab, category: string): Draft => ({
  name: '', category, tab, kind: 'fixed', n: 1, extra: 0, overnightOnly: false, perPerson: false,
})

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="pt-0.5"><Checkbox checked={checked} onChange={onChange} label={label} /></div>
      <button type="button" onClick={onChange} className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] text-ink">{label}</span>
        <span className="block text-[12px] text-ink-2">{hint}</span>
      </button>
    </div>
  )
}

function BaseItemSheet({ editing, tab, onClose, onDelete }: {
  editing: PackingBaseItem | 'new' | null; tab: PackTab; onClose: () => void; onDelete: (b: PackingBaseItem) => void
}) {
  const h = useHousehold()
  const cur = editing && editing !== 'new' ? editing : null
  const inTab = h.packingBase.filter((b) => b.tab === (cur?.tab ?? tab))
  const [f, setF] = useState<Draft>(emptyDraft(tab, ''))
  const [key, setKey] = useState<string | null>(null)
  const k = editing === null ? null : cur?.id ?? `new-${tab}`
  if (k !== key) {
    setKey(k)
    setF(cur
      ? { name: cur.name, category: cur.category, tab: cur.tab, kind: cur.kind, n: cur.n, extra: cur.extra, overnightOnly: cur.overnightOnly, perPerson: cur.perPerson }
      : emptyDraft(tab, groupByCategory(inTab).at(-1)?.category ?? OTHER_CATEGORY))
  }
  const set = (p: Partial<Draft>) => setF({ ...f, ...p })
  const ok = !!f.name.trim() && !!f.category.trim()
  const save = async () => {
    if (!ok) return
    const d = { ...f, name: f.name.trim(), category: f.category.trim(), perPerson: f.tab === 'kid' && f.perPerson }
    if (cur) {
      // Moved to another tab or category: goes to the end there.
      const moved = d.tab !== cur.tab || d.category !== cur.category
      await updateBaseItem(h.hid, cur.id, moved ? { ...d, order: nextOrder(h.packingBase) } : d)
    } else {
      await addBaseItem(h.hid, { ...d, order: nextOrder(h.packingBase) })
    }
    onClose()
  }
  const kinds: { value: PackRuleKind; label: string }[] = (['fixed', 'perDay', 'perNight'] as const).map((value) => ({ value, label: t(`packing.kind.${value}`) }))
  return (
    <Sheet open={editing !== null} onClose={onClose} title={cur ? t('packing.editTitle') : t('packing.addTitle')}>
      <div className="flex flex-col gap-4">
        <Field label={t('trip.itemName')} value={f.name} placeholder={t('trip.addPlaceholder')} onChange={(e) => set({ name: e.target.value })} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">{t('packing.tab')}</span>
          <Segmented value={f.tab} onChange={(x) => set({ tab: x })} options={PACK_TABS.map((x) => ({ value: x, label: tabLabel(x) }))} />
        </div>
        <CategoryPicker value={f.category} onChange={(category) => set({ category })} used={h.packingBase.filter((b) => b.tab === f.tab)} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">{t('packing.rule')}</span>
          <Segmented value={f.kind} onChange={(kind) => set({ kind })} options={kinds} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] text-ink">{t(`packing.nLabel.${f.kind}`)}</span>
          <QtyStepper label={t(`packing.nLabel.${f.kind}`)} value={f.n} onChange={(n) => set({ n })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] text-ink">{t('packing.extra')}</span>
          <QtyStepper label={t('packing.extra')} value={f.extra} min={0} onChange={(extra) => set({ extra })} />
        </div>
        <Toggle checked={f.overnightOnly} onChange={() => set({ overnightOnly: !f.overnightOnly })} label={t('packing.overnightOnly')} hint={t('packing.overnightOnlyHint')} />
        {f.tab === 'kid' && (
          <Toggle checked={f.perPerson} onChange={() => set({ perPerson: !f.perPerson })} label={t('packing.perPerson')} hint={t('packing.perPersonHint')} />
        )}
        <p className="rounded-[var(--radius-field)] bg-muted px-3.5 py-2.5 text-[13px] text-ink-2">
          {t('packing.preview', { rule: ruleLabel(f, f.tab) })}
        </p>
        <div className="flex gap-2">
          {cur && <Button variant="soft" aria-label={t('action.delete')} onClick={() => { onClose(); onDelete(cur) }}><Trash2 size={18} /></Button>}
          <Button className="flex-1" disabled={!ok} onClick={save}>{t('action.save')}</Button>
        </div>
      </div>
    </Sheet>
  )
}

/** The base list a new trip is counted from. Changing it does not touch trips already made. */
export function PackingBaseScreen({ wide = false }: { wide?: boolean }) {
  const h = useHousehold()
  const [tab, setTab] = useState<PackTab>('kid')
  const [editing, setEditing] = useState<PackingBaseItem | 'new' | null>(null)
  const notice = useNotice()

  // First use: the default kid list goes in once the (empty) list has loaded.
  useEffect(() => {
    if (h.packingLoaded) void ensurePackingBase(h.hid, h.packingBase, h.settings.packingSeeded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.packingLoaded])

  const groups = groupByCategory(h.packingBase.filter((b) => b.tab === tab))
  const remove = (b: PackingBaseItem) => {
    void deleteBaseItem(h.hid, b.id)
    notice.show(t('trip.deleted', { name: b.name }), () => restoreBaseItem(h.hid, b))
  }
  const body = (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-ink-2">{t('packing.hint')}</p>
      <div className="grid grid-cols-4 gap-1 rounded-full bg-muted p-1" role="tablist">
        {PACK_TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={x === tab} onClick={() => setTab(x)}
            className={`h-10 rounded-full text-[14px] font-semibold ${x === tab ? 'bg-white text-ink shadow-sm' : 'text-ink-2'}`}>
            {tabLabel(x)}
            <span className="ml-1 text-[12px] font-normal text-ink-2">{h.packingBase.filter((b) => b.tab === x).length}</span>
          </button>
        ))}
      </div>
      <Card>
        <CardHeader title={t('packing.tabTitle', { tab: tabLabel(tab) })} action={
          <IconButton label={t('packing.addTitle')} onClick={() => setEditing('new')}><Plus size={18} /></IconButton>
        } />
        {groups.length === 0 && <Empty>{t('packing.empty')}</Empty>}
        {groups.map((g, i) => (
          <div key={g.category} className={i ? 'mt-3 border-t border-line pt-3' : ''}>
            <p className="mb-0.5 text-[13px] font-semibold text-ink-2">{g.category}</p>
            {g.items.map((b) => (
              <button key={b.id} type="button" onClick={() => setEditing(b)} className="flex w-full items-center gap-3 py-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-ink [overflow-wrap:anywhere]">{b.name}</span>
                  <span className="block text-[12px] text-ink-2">{ruleLabel(b, b.tab)}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-ink-3" />
              </button>
            ))}
          </div>
        ))}
      </Card>
      <BaseItemSheet editing={editing} tab={tab} onClose={() => setEditing(null)} onDelete={remove} />
      {notice.node}
    </div>
  )
  return wide ? <div className="mx-auto max-w-[760px]">{body}</div> : body
}
