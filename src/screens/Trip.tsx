import { CloudRain, Ellipsis, ListChecks, Pencil, Plus, ShoppingBasket, Sparkles, Thermometer, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  OTHER_CATEGORY, PACK_TABS, canReturnCheck, canReview, forecastRange, groupByCategory, nextOrder, progress, returnProgress,
  reviewProposals, tabItems, tripPhase, weatherTips, type ReviewProposal, type TripForecastDay,
} from '../../shared/packing'
import type { PackTab, Trip, TripItem } from '../../shared/types'
import { CategoryPicker, QtyStepper, TripSheet, durationLabel, ruleLabel, tabLabel, tripDates, tripWhen } from '../components/TripParts'
import { Button, Card, CardHeader, Checkbox, Empty, IconButton, Pill, Sheet, useNotice } from '../components/ui'
import { t } from '../copy'
import {
  addTripItem, applyReviewProposal, deleteTripItem, finishReview, restoreTripItem, setTripItemQty, togglePacked, tripItemToShopping,
  updateTripItem,
} from '../data/actions'
import { useHousehold, useTripItems } from '../data/store'
import { fetchTripForecast } from '../data/tripWeather'

type Mode = 'pack' | 'return' | 'review' | 'proposals'

/** Daily forecast of the trip place for the trip days the forecast reaches; null while there is none to show. */
function useTripForecast(trip: Trip, today: string): TripForecastDay[] | null {
  const range = forecastRange(trip, today)
  const [days, setDays] = useState<TripForecastDay[] | null>(null)
  const key = range && trip.place ? `${trip.place.lat},${trip.place.lon},${range.from},${range.to}` : ''
  useEffect(() => {
    setDays(null)
    if (!key || !trip.place || !range) return
    let live = true
    fetchTripForecast(trip.place.lat, trip.place.lon, range.from, range.to).then((d) => live && setDays(d), () => undefined)
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return days
}

/** Forecast suggestions on top of the 함께 tab; tapping one adds it. Items already on the trip are not offered again. */
function WeatherSuggestions({ trip, items }: { trip: Trip; items: TripItem[] }) {
  const h = useHousehold()
  const days = useTripForecast(trip, h.today)
  const have = new Set(items.map((x) => x.name.trim()))
  const tips = weatherTips(days ?? [])
    .map((tip) => ({ ...tip, names: tip.items.map((k) => t(`trip.tip.item.${k}`)).filter((n) => !have.has(n)) }))
    .filter((tip) => tip.names.length)
  if (!tips.length) return null
  const add = (name: string) => addTripItem(h.hid, trip.id, { name, category: t('trip.tip.category'), tab: 'both', order: nextOrder(items) }, null)
  return (
    <Card ai>
      <CardHeader title={t('trip.tip.title')} icon={<Sparkles size={16} className="text-wisteria" />} />
      <p className="-mt-2 mb-3 text-[12px] text-ink-2">{t('trip.tip.hint')}</p>
      <div className="flex flex-col gap-3">
        {tips.map((tip) => (
          <div key={tip.kind}>
            <p className="flex items-center gap-1.5 text-[13px] text-ink-2">
              {tip.kind === 'rain' ? <CloudRain size={15} className="shrink-0 text-wisteria" /> : <Thermometer size={15} className="shrink-0 text-wisteria" />}
              {tip.kind === 'rain' ? t('trip.tip.rain', { pop: tip.pop }) : t('trip.tip.cold', { min: tip.minC })}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tip.names.map((name) => (
                <button key={name} type="button" onClick={() => add(name)}
                  className="flex h-9 items-center gap-1 rounded-full bg-white px-3.5 text-[13px] font-semibold text-ink shadow-sm">
                  <Plus size={14} className="text-sage" />{name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function TabBar({ tab, onTab, items, mode }: { tab: PackTab; onTab: (t: PackTab) => void; items: TripItem[]; mode: Mode }) {
  return (
    <div className="grid grid-cols-4 gap-1 rounded-[1.25rem] bg-muted p-1" role="tablist">
      {PACK_TABS.map((x) => {
        const p = mode === 'return' ? returnProgress(items, x) : null
        const q = progress(items, x)
        const done = p ? p.returned : q.packed
        const total = p ? p.total : q.total
        const active = x === tab
        return (
          <button key={x} type="button" role="tab" aria-selected={active} onClick={() => onTab(x)}
            className={`flex h-14 flex-col items-center justify-center rounded-2xl text-[14px] font-semibold transition-colors ${active ? 'bg-white text-ink shadow-sm' : 'text-ink-2'}`}>
            {tabLabel(x)}
            {mode !== 'review' && mode !== 'proposals' && (
              <span className={`text-[12px] tabular-nums ${total > 0 && done === total ? 'text-sage' : 'text-ink-2'}`}>
                {t('trip.tabCount', { done, total })}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Bottom of a tab: a line typed by hand, with its category and 「기본 목록에도 넣기」. */
function AddLine({ trip, tab, items }: { trip: Trip; tab: PackTab; items: TripItem[] }) {
  const h = useHousehold()
  const inTab = items.filter((x) => x.tab === tab)
  const [name, setName] = useState('')
  // null: not picked yet (기타); '' while a new category is being typed.
  const [category, setCategory] = useState<string | null>(null)
  const [alsoBase, setAlsoBase] = useState(false)
  const [lastTab, setLastTab] = useState(tab)
  if (tab !== lastTab) {
    setLastTab(tab)
    setCategory(null)
  }
  const cat = category ?? OTHER_CATEGORY
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !cat.trim()) return
    const n = name
    setName('')
    // In the tab's list order: after the last line of the same category, or at the end.
    const sameCat = inTab.filter((x) => x.category === cat.trim())
    const order = sameCat.length ? Math.max(...sameCat.map((x) => x.order)) + 0.001 : nextOrder(items)
    await addTripItem(h.hid, trip.id, { name: n, category: cat.trim(), tab, order }, alsoBase ? { order: nextOrder(h.packingBase) } : null)
  }
  return (
    <form onSubmit={add} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('trip.addPlaceholder')} aria-label={t('trip.addPlaceholder')}
          className="h-12 min-w-0 flex-1 rounded-[var(--radius-field)] border border-sand bg-white px-3.5 text-[15px] outline-none placeholder:text-ink-3 focus:border-sage" />
        <Button type="submit" className="w-12 px-0" aria-label={t('action.add')} disabled={!name.trim() || !cat.trim()}><Plus size={20} /></Button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <CategoryPicker compact value={cat} onChange={setCategory} used={inTab} />
        <label className="flex h-12 cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink-2">
          <Checkbox checked={alsoBase} onChange={() => setAlsoBase(!alsoBase)} label={t('trip.alsoBase')} />
          <span onClick={() => setAlsoBase(!alsoBase)}>{t('trip.alsoBase')}</span>
        </label>
      </div>
    </form>
  )
}

function PackRow({ item, onMenu }: { item: TripItem; onMenu: () => void }) {
  const h = useHousehold()
  const toggle = () => togglePacked(h.hid, item, h.uid)
  return (
    <div className="flex items-center gap-2 py-1.5">
      <Checkbox checked={item.packed} onChange={toggle} label={item.name} />
      <button type="button" onClick={toggle} className="min-h-10 min-w-0 flex-1 py-1 pl-1 text-left">
        <span className={`block text-[15px] [overflow-wrap:anywhere] ${item.packed ? 'done-text' : 'text-ink'}`}>{item.name}</span>
      </button>
      <QtyStepper label={t('trip.qtyOf', { name: item.name })} value={item.qty} onChange={(n) => setTripItemQty(h.hid, item, n)} />
      <IconButton label={t('trip.itemMenu', { name: item.name })} onClick={onMenu} className="-mr-2"><Ellipsis size={18} /></IconButton>
    </div>
  )
}

function ReturnRow({ item }: { item: TripItem }) {
  const h = useHousehold()
  const toggle = () => updateTripItem(h.hid, item.id, { returned: !item.returned })
  return (
    <div className="flex items-center gap-2 py-1.5">
      <Checkbox checked={item.returned} onChange={toggle} label={item.name} />
      <button type="button" onClick={toggle} className="min-h-10 min-w-0 flex-1 py-1 pl-1 text-left">
        <span className={`text-[15px] [overflow-wrap:anywhere] ${item.returned ? 'done-text' : 'text-ink'}`}>{item.name}</span>
        {item.qty > 1 && <span className="ml-1.5 text-[13px] text-ink-2">{t('trip.qtyUnit', { n: item.qty })}</span>}
      </button>
    </div>
  )
}

function ReviewRow({ item }: { item: TripItem }) {
  const h = useHousehold()
  const set = (v: 'unused' | 'short') => updateTripItem(h.hid, item.id, { review: item.review === v ? null : v })
  const chip = (v: 'unused' | 'short') => (
    <button type="button" aria-pressed={item.review === v} onClick={() => set(v)}
      className={`h-9 shrink-0 rounded-full px-3 text-[13px] font-semibold transition-colors ${
        item.review === v ? (v === 'short' ? 'bg-terra text-white' : 'bg-ink-2 text-white') : 'bg-muted text-ink-2'}`}>
      {t(`trip.review.${v}`)}
    </button>
  )
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className={`min-w-0 flex-1 text-[15px] [overflow-wrap:anywhere] ${item.packed ? 'text-ink' : 'text-ink-3'}`}>
        {item.name}
        {item.qty > 1 && <span className="ml-1.5 text-[13px] text-ink-2">{t('trip.qtyUnit', { n: item.qty })}</span>}
      </span>
      {chip('unused')}
      {chip('short')}
    </div>
  )
}

/** Approve the review's suggestions one by one, then finish (unused streaks are written then). */
function Proposals({ trip, items, onDone }: { trip: Trip; items: TripItem[]; onDone: () => void }) {
  const h = useHousehold()
  const [handled, setHandled] = useState<Set<string>>(new Set())
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const keyOf = (p: ReviewProposal) => `${p.kind}:${p.baseId}`
  const list = reviewProposals(items, h.packingBase).filter((p) => !handled.has(keyOf(p)))
  const handle = async (p: ReviewProposal, apply: boolean) => {
    setHandled(new Set([...handled, keyOf(p)]))
    if (!apply) return
    if (p.kind === 'remove') setRemoved(new Set([...removed, p.baseId]))
    await applyReviewProposal(h.hid, p)
  }
  const finish = async () => {
    setBusy(true)
    try {
      await finishReview(h.hid, trip.id, items, h.packingBase.filter((b) => !removed.has(b.id)))
      onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader title={t('trip.proposalsTitle')} />
      <p className="-mt-2 mb-2 text-[12px] text-ink-2">{t('trip.proposalsHint')}</p>
      {list.length === 0 && <Empty>{t('trip.proposalsEmpty')}</Empty>}
      <div className="divide-y divide-line">
        {list.map((p) => {
          const b = h.packingBase.find((x) => x.id === p.baseId)
          return (
            <div key={keyOf(p)} className="flex flex-col gap-2 py-3">
              <p className="text-[15px] text-ink">
                {p.kind === 'more' && b
                  ? t('trip.proposeMore', { name: p.name, from: ruleLabel(b, b.tab), to: ruleLabel({ ...b, n: p.to }, b.tab) })
                  : t('trip.proposeRemove', { name: p.name })}
              </p>
              <div className="flex gap-2">
                <Button variant="soft" className="h-10 flex-1 text-[14px]" onClick={() => handle(p, false)}>{t('trip.proposalSkip')}</Button>
                <Button className="h-10 flex-1 text-[14px]" onClick={() => handle(p, true)}>{t('trip.proposalApply')}</Button>
              </div>
            </div>
          )
        })}
      </div>
      <Button className="mt-3 w-full" variant={list.length ? 'soft' : 'primary'} disabled={busy} onClick={finish}>{t('trip.reviewFinish')}</Button>
    </Card>
  )
}

/** Checklist of one trip: tabs 아이·엄마·아빠·함께, grouped by category, shared live between the two phones. */
export function TripScreen({ tripId, onClose, openPacking, wide = false }: {
  tripId: string; onClose: () => void; openPacking: () => void; wide?: boolean
}) {
  const h = useHousehold()
  const trip = h.trips.find((x) => x.id === tripId)
  const items = useTripItems(tripId)
  const [tab, setTab] = useState<PackTab>('kid')
  const [mode, setMode] = useState<Mode>('pack')
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState<TripItem | null>(null)
  const notice = useNotice()
  const seen = useRef(false)
  if (trip) seen.current = true

  // Deleted here or on the other phone: back to where the trip was opened from.
  useEffect(() => { if (!trip && seen.current) onClose() }, [trip, onClose])
  if (!trip) return null

  const all = progress(items)
  const back = returnProgress(items)
  const shown = tabItems(items, tab).filter((x) => mode !== 'return' || x.packed)
  const groups = groupByCategory(shown)
  const returnOn = mode === 'return'
  const reviewing = mode === 'review' || mode === 'proposals'

  // Writes are not awaited before the notice: offline they only finish once the phone is back online.
  const remove = (item: TripItem) => {
    setMenu(null)
    void deleteTripItem(h.hid, item.id)
    notice.show(t('trip.deleted', { name: item.name }), () => restoreTripItem(h.hid, item))
  }
  const toShopping = (item: TripItem) => {
    setMenu(null)
    void tripItemToShopping(h.hid, h.uid, item, item.qty > 1 ? t('trip.qtyUnit', { n: item.qty }) : undefined)
    notice.show(t('trip.toShoppingDone', { name: item.name }))
  }

  const body = (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {tripPhase(trip, h.today) !== 'past' && <p className="text-[13px] font-semibold text-terra-2">{tripWhen(trip, h.today)}</p>}
            <p className="mt-0.5 text-[15px] text-ink">{tripDates(trip)} · {durationLabel(trip.nights)}</p>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {t('trip.kidsCount', { n: trip.kids })}
              {trip.place && ` · ${trip.place.label}`}
            </p>
          </div>
          <IconButton label={t('trip.editTitle')} onClick={() => setEditing(true)} className="-mr-2 -mt-1"><Pencil size={18} /></IconButton>
        </div>
        <p className="mt-3 text-[22px] font-bold tracking-tight text-sage">
          {returnOn ? t('trip.returnProgress', { done: back.returned, total: back.total }) : t('trip.packedCount', { packed: all.packed, total: all.total })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {canReturnCheck(trip, h.today) && !reviewing && (
            <Button variant={returnOn ? 'primary' : 'soft'} className="h-10 px-4 text-[14px]" aria-pressed={returnOn}
              onClick={() => setMode(returnOn ? 'pack' : 'return')}>
              {returnOn ? t('trip.returnOff') : t('trip.returnOn')}
            </Button>
          )}
          {canReview(trip, h.today) && !reviewing && (
            <Button variant="urgent" className="h-10 px-4 text-[14px]" onClick={() => setMode('review')}>{t('trip.review')}</Button>
          )}
          <Button variant="ghost" className="h-10 px-3 text-[14px]" onClick={openPacking}><ListChecks size={16} />{t('packing.title')}</Button>
        </div>
        {returnOn && <p className="mt-2 text-[12px] text-ink-2">{t('trip.returnHint')}</p>}
      </Card>

      {mode === 'proposals' ? <Proposals trip={trip} items={items} onDone={() => { setMode('pack'); notice.show(t('trip.reviewDone')) }} /> : (
        <>
          {reviewing && (
            <div className="rounded-[var(--radius-card)] bg-peach-soft px-5 py-4">
              <p className="text-[15px] font-semibold text-terra-2">{t('trip.review')}</p>
              <p className="mt-1 text-[13px] text-ink">{t('trip.reviewHint')}</p>
            </div>
          )}
          <TabBar tab={tab} onTab={setTab} items={items} mode={mode} />
          {tab === 'both' && mode === 'pack' && <WeatherSuggestions trip={trip} items={items} />}
          <Card>
            {groups.length === 0 && <Empty>{returnOn ? t('trip.returnEmpty') : t('trip.tabEmpty')}</Empty>}
            {groups.map((g, i) => (
              <div key={g.category} className={i ? 'mt-3 border-t border-line pt-3' : ''}>
                <p className="mb-0.5 text-[13px] font-semibold text-ink-2">{g.category}</p>
                {g.items.map((x) => (
                  returnOn ? <ReturnRow key={x.id} item={x} />
                    : reviewing ? <ReviewRow key={x.id} item={x} />
                    : <PackRow key={x.id} item={x} onMenu={() => setMenu(x)} />
                ))}
              </div>
            ))}
            {mode === 'pack' && <AddLine trip={trip} tab={tab} items={items} />}
          </Card>
          {reviewing && (
            <div className="flex gap-2">
              <Button variant="soft" className="flex-1" onClick={() => setMode('pack')}>{t('action.cancel')}</Button>
              <Button className="flex-1" onClick={() => setMode('proposals')}>{t('trip.reviewNext')}</Button>
            </div>
          )}
        </>
      )}

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.name ?? ''}>
        {menu && (
          <div className="flex flex-col gap-2">
            <p className="-mt-2 mb-1 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
              {menu.category}
              {menu.auto && menu.rule && <Pill>{ruleLabel(menu.rule, menu.tab)}</Pill>}
            </p>
            <Button variant="soft" className="justify-start" onClick={() => toShopping(menu)}>
              <ShoppingBasket size={18} className="text-terra" />{t('trip.toShopping')}
            </Button>
            <Button variant="soft" className="justify-start text-terra-2" onClick={() => remove(menu)}>
              <Trash2 size={18} />{t('action.delete')}
            </Button>
          </div>
        )}
      </Sheet>
      <TripSheet editing={editing ? trip : null} items={items} onClose={() => setEditing(false)} />
      {notice.node}
    </div>
  )
  return wide ? <div className="mx-auto max-w-[760px]">{body}</div> : body
}
