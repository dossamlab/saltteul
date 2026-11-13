import { ChevronDown, ListChecks, Luggage, Plus } from 'lucide-react'
import { useState } from 'react'
import { reviewOffered, sortTrips, tripPhase } from '../../shared/packing'
import { t } from '../copy'
import { useHousehold } from '../data/store'
import { TripLine, TripSheet } from './TripParts'
import { Card, CardHeader, Empty, IconButton } from './ui'

/**
 * Top of 「우리 집」: trips coming up or under way, trips just back that wait for their review, then past trips folded
 * away. 「새 여행」 opens the trip form; a new trip opens its checklist.
 */
export function TripSection({ openTrip, openPacking }: { openTrip: (id: string) => void; openPacking: () => void }) {
  const h = useHousehold()
  const [adding, setAdding] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const sorted = sortTrips(h.trips, h.today)
  const live = sorted.filter((x) => tripPhase(x, h.today) !== 'past')
  const toReview = sorted.filter((x) => reviewOffered(x, h.today))
  const past = sorted.filter((x) => tripPhase(x, h.today) === 'past' && !reviewOffered(x, h.today))
  return (
    <Card>
      <CardHeader title={t('trip.title')} icon={<Luggage size={18} className="text-sage" />} action={
        <IconButton label={t('trip.add')} onClick={() => setAdding(true)}><Plus size={18} /></IconButton>
      } />
      {live.length === 0 && toReview.length === 0 && <Empty>{t('trip.empty')}</Empty>}
      <div className="divide-y divide-line">
        {live.map((x) => <TripLine key={x.id} trip={x} items={h.tripItems} onOpen={() => openTrip(x.id)} />)}
        {toReview.map((x) => <TripLine key={x.id} trip={x} onOpen={() => openTrip(x.id)} badge={t('trip.review')} />)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={openPacking}
          className="flex h-9 items-center gap-1.5 rounded-full bg-muted px-3.5 text-[13px] font-semibold text-ink">
          <ListChecks size={15} className="text-sage" />
          {t('packing.title')}
        </button>
        {past.length > 0 && (
          <button type="button" onClick={() => setShowPast(!showPast)} aria-expanded={showPast}
            className="flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-ink-2">
            {t('trip.pastCount', { n: past.length })}
            <ChevronDown size={16} className={`transition-transform ${showPast ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {showPast && (
        <div className="mt-1 divide-y divide-line border-t border-line">
          {past.map((x) => <TripLine key={x.id} trip={x} onOpen={() => openTrip(x.id)} />)}
        </div>
      )}
      <TripSheet editing={adding ? 'new' : null} onClose={() => setAdding(false)} onCreated={openTrip} />
    </Card>
  )
}
