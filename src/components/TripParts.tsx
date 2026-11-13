import { ChevronRight, Luggage, MapPin, Minus, Plus, Search, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { addDays } from '../../shared/householdDate'
import { categoryChoices, daysToStart, progress, returnDay, tripPhase } from '../../shared/packing'
import type { PackRule, PackTab, Trip, TripItem, Ymd } from '../../shared/types'
import { t } from '../copy'
import { createTrip, deleteTrip, updateTrip, type TripDraft } from '../data/actions'
import { useHousehold } from '../data/store'
import { formatDay, dDayLabel } from '../format'
import { searchPlace, type PlaceResult } from '../geo/searchPlace'
import { Button, Empty, Field, IconButton, Segmented, Sheet } from './ui'

/** 「당일」 or 「2박 3일」. */
export const durationLabel = (nights: number) => (nights > 0 ? t('trip.nightsDays', { n: nights, d: nights + 1 }) : t('trip.dayTrip'))

/** 「11월 20일 (금) ~ 11월 22일 (일)」, one date for a day trip. */
export const tripDates = (trip: Pick<Trip, 'start' | 'nights'>) =>
  trip.nights > 0 ? t('trip.dateRange', { from: formatDay(trip.start), to: formatDay(returnDay(trip)) }) : formatDay(trip.start)

/** D-3, D-day, 「여행 중」 or, for a past trip, its dates. */
export function tripWhen(trip: Pick<Trip, 'start' | 'nights'>, today: Ymd): string {
  const phase = tripPhase(trip, today)
  if (phase === 'upcoming' || (phase === 'ongoing' && trip.start === today)) return dDayLabel(daysToStart(trip, today))
  return phase === 'ongoing' ? t('trip.ongoing') : tripDates(trip)
}

export const tabLabel = (tab: PackTab) => t(`trip.tab.${tab}`)

/** 「하루 6개 · 아이마다」, 「1개 · 1박 이상」 */
export function ruleLabel(r: PackRule, tab: PackTab): string {
  const main = t(`packing.rule.${r.kind}`, { n: r.n })
  return [
    r.extra > 0 ? t('packing.rule.withExtra', { rule: main, n: r.extra }) : main,
    tab === 'kid' && r.perPerson ? t('packing.rule.perPerson') : '',
    r.overnightOnly ? t('packing.rule.overnightOnly') : '',
  ].filter(Boolean).join(' · ')
}

/** − n + for a whole number. */
export function QtyStepper({ value, onChange, min = 1, max = 99, label }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; label: string
}) {
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={label}>
      <IconButton label={t('trip.less')} disabled={value <= min} onClick={() => onChange(value - 1)} className="h-8 w-8 bg-muted disabled:opacity-40">
        <Minus size={15} />
      </IconButton>
      <span className="min-w-7 text-center text-[15px] font-semibold tabular-nums text-ink">{value}</span>
      <IconButton label={t('trip.more')} disabled={value >= max} onClick={() => onChange(value + 1)} className="h-8 w-8 bg-muted disabled:opacity-40">
        <Plus size={15} />
      </IconButton>
    </div>
  )
}

const CUSTOM = '__custom__'

/** Category from the list in use and the defaults, or typed in. */
export function CategoryPicker({ value, onChange, used, compact = false }: {
  value: string; onChange: (v: string) => void; used: { category: string; order: number }[]; compact?: boolean
}) {
  const choices = categoryChoices(used)
  const [typing, setTyping] = useState(false)
  const custom = typing || (value !== '' && !choices.includes(value))
  const select = (
    <select value={custom ? CUSTOM : value} aria-label={t('trip.category')}
      onChange={(e) => {
        if (e.target.value === CUSTOM) {
          setTyping(true)
          onChange('')
        } else {
          setTyping(false)
          onChange(e.target.value)
        }
      }}
      className={`h-12 rounded-[var(--radius-field)] border border-sand bg-white px-3 text-[15px] text-ink outline-none focus:border-sage ${compact ? 'w-full min-w-0' : 'w-full'}`}>
      {choices.map((c) => <option key={c} value={c}>{c}</option>)}
      <option value={CUSTOM}>{t('trip.categoryCustom')}</option>
    </select>
  )
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {compact ? select : (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">{t('trip.category')}</span>
          {select}
        </label>
      )}
      {custom && (
        <input value={value} autoFocus={typing} onChange={(e) => onChange(e.target.value)} placeholder={t('trip.categoryPlaceholder')}
          aria-label={t('trip.categoryPlaceholder')}
          className="h-12 w-full min-w-0 rounded-[var(--radius-field)] border border-sand bg-white px-3.5 text-[15px] outline-none placeholder:text-ink-3 focus:border-sage" />
      )}
    </div>
  )
}

/** Trip place from the same place search as the weather location (Korea only); optional. */
function PlaceField({ value, onChange }: { value: Trip['place']; onChange: (p: Trip['place']) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const search = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    setFailed(false)
    try {
      setResults(await searchPlace(query))
    } catch {
      setResults(null)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">{t('trip.place')}</span>
      {value ? (
        <div className="flex h-12 items-center gap-2 rounded-[var(--radius-field)] bg-muted pl-3.5 pr-1">
          <MapPin size={16} className="shrink-0 text-sage" />
          <span className="min-w-0 flex-1 truncate text-[15px]">{value.label}</span>
          <IconButton label={t('trip.placeClear')} onClick={() => onChange(null)}><X size={18} /></IconButton>
        </div>
      ) : (
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('trip.placePlaceholder')} aria-label={t('trip.placePlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') void search(e) }}
            className="h-12 min-w-0 flex-1 rounded-[var(--radius-field)] border border-sand bg-white px-3.5 text-[15px] outline-none placeholder:text-ink-3 focus:border-sage" />
          <Button type="button" variant="soft" className="w-12 px-0" aria-label={t('settings.locationSearch')} disabled={busy || !query.trim()} onClick={() => search()}>
            <Search size={18} />
          </Button>
        </div>
      )}
      {!value && results && results.length === 0 && <Empty>{t('settings.locationNoResult')}</Empty>}
      {!value && results && results.length > 0 && (
        <div className="divide-y divide-line rounded-[var(--radius-field)] border border-line">
          {results.map((r) => (
            <button key={r.detail} type="button" onClick={() => { onChange({ label: r.label, lat: r.lat, lon: r.lon }); setResults(null); setQuery('') }}
              className="flex w-full flex-col items-start px-3.5 py-2.5 text-left hover:bg-muted">
              <span className="text-[15px]">{r.label}</span>
              <span className="text-[12px] text-ink-2">{r.detail}</span>
            </button>
          ))}
        </div>
      )}
      {failed && <p className="text-[13px] text-ink-2">{t('settings.locationSearchFailed')}</p>}
      <p className="text-[12px] text-ink-2">{t('trip.placeHint')}</p>
    </div>
  )
}

type Length = '0' | '1' | '2' | 'custom'

/** New trip, or edit of one (with delete behind a second question). */
export function TripSheet({ editing, items = [], onClose, onCreated, onDeleted }: {
  editing: Trip | 'new' | null
  items?: TripItem[]
  onClose: () => void
  onCreated?: (id: string) => void
  onDeleted?: () => void
}) {
  const h = useHousehold()
  const cur = editing && editing !== 'new' ? editing : null
  const [f, setF] = useState({ name: '', start: '', length: '1' as Length, nights: '3', kids: 1, place: null as Trip['place'] })
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const k = editing === null ? null : cur?.id ?? 'new'
  if (k !== key) {
    setKey(k)
    const n = cur?.nights ?? 1
    setF({
      name: cur?.name ?? '', start: cur?.start ?? addDays(h.today, 7), length: n <= 2 ? (String(n) as Length) : 'custom',
      nights: String(n), kids: cur?.kids ?? 1, place: cur?.place ?? null,
    })
    setConfirm(false)
  }
  const nights = f.length === 'custom' ? Math.min(30, Math.max(0, Math.round(Number(f.nights) || 0))) : Number(f.length)
  const ok = !!f.name.trim() && /^\d{4}-\d{2}-\d{2}$/.test(f.start) && !busy
  const save = async () => {
    if (!ok) return
    setBusy(true)
    const d: TripDraft = { name: f.name, start: f.start, nights, kids: f.kids, place: f.place }
    try {
      if (cur) {
        await updateTrip(h.hid, cur, d, items)
        onClose()
      } else {
        const id = await createTrip(h.hid, h.uid, d, h.packingBase, h.settings.packingSeeded || !h.packingLoaded)
        onClose()
        onCreated?.(id)
      }
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!cur) return
    setBusy(true)
    try {
      await deleteTrip(h.hid, cur.id)
      setConfirm(false)
      onClose()
      onDeleted?.()
    } finally {
      setBusy(false)
    }
  }
  const lengths: { value: Length; label: string }[] = [
    { value: '0', label: t('trip.dayTrip') },
    { value: '1', label: durationLabel(1) },
    { value: '2', label: durationLabel(2) },
    { value: 'custom', label: t('trip.lengthCustom') },
  ]
  return (
    <>
      <Sheet open={editing !== null && !confirm} onClose={onClose} title={cur ? t('trip.editTitle') : t('trip.addTitle')}>
        <div className="flex flex-col gap-4">
          <Field label={t('trip.name')} value={f.name} placeholder={t('trip.namePlaceholder')} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Field label={t('trip.start')} type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink-2">{t('trip.length')}</span>
            <Segmented value={f.length} onChange={(length) => setF({ ...f, length })} options={lengths} />
            {f.length === 'custom' && (
              <div className="mt-1 flex items-center gap-2">
                <input type="number" inputMode="numeric" min={0} max={30} value={f.nights} aria-label={t('trip.nightsLabel')}
                  onChange={(e) => setF({ ...f, nights: e.target.value })}
                  className="h-12 w-24 rounded-[var(--radius-field)] border border-sand bg-white px-3.5 text-[15px] outline-none focus:border-sage" />
                <span className="text-[15px] text-ink">{t('trip.nightsUnit')}</span>
                <span className="text-[13px] text-ink-2">{durationLabel(nights)}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-ink-2">{t('trip.kids')}</span>
            <QtyStepper label={t('trip.kids')} value={f.kids} max={9} onChange={(kids) => setF({ ...f, kids })} />
          </div>
          <PlaceField value={f.place} onChange={(place) => setF({ ...f, place })} />
          {cur && (nights !== cur.nights || f.kids !== cur.kids) && <p className="text-[12px] text-ink-2">{t('trip.recountHint')}</p>}
          <div className="flex gap-2">
            {cur && (
              <Button variant="soft" aria-label={t('trip.delete')} onClick={() => setConfirm(true)}><Trash2 size={18} /></Button>
            )}
            <Button className="flex-1" disabled={!ok} onClick={save}>{cur ? t('action.save') : t('trip.create')}</Button>
          </div>
        </div>
      </Sheet>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title={t('trip.deleteTitle')}>
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-ink">{t('trip.deleteBody', { name: cur?.name ?? '' })}</p>
          <div className="flex gap-2">
            <Button variant="soft" className="flex-1" onClick={() => setConfirm(false)}>{t('action.cancel')}</Button>
            <Button variant="urgent" className="flex-1" disabled={busy} onClick={remove}>{t('action.delete')}</Button>
          </div>
        </div>
      </Sheet>
    </>
  )
}

/** One trip as a tappable line: name, when, and packed/total. */
export function TripLine({ trip, items, onOpen, badge }: { trip: Trip; items?: TripItem[]; onOpen: () => void; badge?: string }) {
  const h = useHousehold()
  const p = items ? progress(items.filter((x) => x.tripId === trip.id)) : null
  const past = tripPhase(trip, h.today) === 'past'
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-2.5 text-left">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sage-soft text-sage"><Luggage size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-ink">{trip.name}</span>
        <span className="block truncate text-[12px] text-ink-2">
          {tripDates(trip)} · {durationLabel(trip.nights)}
          {trip.place && ` · ${trip.place.label}`}
        </span>
      </span>
      {badge ? <span className="shrink-0 rounded-full bg-peach-soft px-2 py-0.5 text-[11px] font-semibold text-terra-2">{badge}</span> : !past && (
        <span className="flex shrink-0 flex-col items-end">
          <span className="text-[13px] font-semibold text-terra-2">{tripWhen(trip, h.today)}</span>
          {p && p.total > 0 && <span className="text-[12px] tabular-nums text-ink-2">{t('trip.packedCount', { packed: p.packed, total: p.total })}</span>}
        </span>
      )}
      <ChevronRight size={18} className="shrink-0 text-ink-3" />
    </button>
  )
}
