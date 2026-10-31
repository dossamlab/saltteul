import { Cake, CloudDrizzle, CloudSnow, Cloud, CloudSun, Heart, Sparkles, Sun, Undo2, UtensilsCrossed } from 'lucide-react'
import { togetherDays, upcoming } from '../../shared/anniversaries'
import type { Briefing, WeatherDay } from '../../shared/types'
import { t } from '../copy'
import { undoKidsnoteBatch } from '../data/actions'
import { useHousehold } from '../data/store'
import { dDayLabel, formatDay, relativeDay } from '../format'
import { KidsnoteHistoryButton } from './KidsnoteHistory'
import { Card, CardHeader, Empty, Pill } from './ui'

const SLOT_KEY: Record<Briefing['slot'], string> = { morning: 'brief.morning', evening: 'brief.evening', weekly: 'brief.weekly' }

export function BriefingCard({ large = false, className = '' }: { large?: boolean; className?: string }) {
  const h = useHousehold()
  const latest = h.briefings[0]
  return (
    <Card ai className={`${large ? 'flex flex-col' : ''} ${className}`}>
      <CardHeader
        title={t('brief.title')}
        icon={<span className="grid h-7 w-7 place-items-center rounded-full bg-lavender/60 text-wisteria"><Sparkles size={15} /></span>}
        action={latest && <Pill tone="ai">{t(SLOT_KEY[latest.slot] ?? 'brief.morning')}</Pill>}
      />
      {latest ? (
        <div className={large ? 'flex flex-1 flex-col' : ''}>
          <p className={`font-semibold text-ink ${large ? 'mt-1 text-[24px] leading-[1.4] tracking-tight' : 'text-[16px] leading-snug'}`}>{latest.headline}</p>
          <ul className={`flex flex-col ${large ? 'mt-5 gap-2.5' : 'mt-2 gap-1.5'}`}>
            {latest.lines.map((l, i) => (
              <li key={i} className={`flex gap-2.5 leading-relaxed text-ink ${large ? 'text-[16px]' : 'text-[14px]'}`}>
                <span className={`shrink-0 rounded-full bg-wisteria ${large ? 'mt-[11px] h-1.5 w-1.5' : 'mt-[9px] h-1 w-1'}`} />
                <span>{l}</span>
              </li>
            ))}
          </ul>
          <p className={`text-ink-2 ${large ? 'mt-auto pt-5 text-[12px]' : 'mt-3 text-[11px]'}`}>
            {latest.model ? t('brief.byClaude', { day: relativeDay(latest.day, h.today) }) : t('brief.fallbackNote')}
          </p>
        </div>
      ) : (
        <Empty>{t('brief.empty', { morning: h.settings.briefingTimes.morning, evening: h.settings.briefingTimes.evening })}</Empty>
      )}
    </Card>
  )
}

const SKY_ICON: Record<NonNullable<WeatherDay['sky']>, typeof Sun> = {
  clear: Sun, partly: CloudSun, cloudy: Cloud, rain: CloudDrizzle, shower: CloudDrizzle, snow: CloudSnow, rainsnow: CloudSnow,
}

export function WeatherCard({ className = '' }: { className?: string }) {
  const h = useHousehold()
  const days = h.settings.weather?.days ?? []
  if (!h.settings.location) {
    return (
      <Card className={className}>
        <CardHeader title={t('weather.title')} />
        <Empty>{t('weather.noLocation')}</Empty>
      </Card>
    )
  }
  return (
    <Card className={className}>
      <CardHeader title={t('weather.title')} action={<span className="text-[12px] text-ink-2">{h.settings.location.label}</span>} />
      {days.length === 0 && <Empty>{t('weather.loading')}</Empty>}
      <div className="grid grid-cols-2 gap-2.5">
        {days.slice(0, 2).map((d) => {
          const Icon = d.sky ? SKY_ICON[d.sky] : Cloud
          return (
            <div key={d.day} className="rounded-[var(--radius-field)] bg-muted p-3">
              <p className="text-[12px] font-semibold text-ink-2">{relativeDay(d.day, h.today)}</p>
              <div className="mt-1 flex items-center gap-2">
                <Icon size={26} className="text-sage" />
                <p className="text-[15px] font-semibold">
                  {t('weather.range', { min: d.minC ?? '-', max: d.maxC ?? '-' })}
                </p>
              </div>
              <p className="mt-1 text-[12px] text-ink-2">
                {d.rainFrom ? t('weather.rainFrom', { time: d.rainFrom, pop: d.popMax ?? 0 }) : t('weather.pop', { pop: d.popMax ?? 0 })}
              </p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export function AnniversaryStrip() {
  const h = useHousehold()
  const next = upcoming(h.anniversaries, h.today, 3)
  if (!next.length) return null
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      {next.map((a) => (
        <div key={a.id} className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 shadow-[var(--shadow-card)]">
          <span className="text-[13px] font-semibold text-terra-2">{dDayLabel(a.daysLeft)}</span>
          <span className="text-[13px] text-ink">{a.title}</span>
          <span className="text-[11px] text-ink-2">{formatDay(a.next)}</span>
        </div>
      ))}
    </div>
  )
}

/** PC home: upcoming anniversaries as a D-day list (phone and tablet keep the chip strip). */
export function AnniversaryCard({ className = '' }: { className?: string }) {
  const h = useHousehold()
  const next = upcoming(h.anniversaries, h.today, 3)
  const together = h.anniversaries.find((a) => a.kind === 'together')
  return (
    <Card className={className}>
      <CardHeader title={t('anniv.upcomingTitle')} icon={<Heart size={17} className="text-terra" />} action={
        together && <span className="text-[12px] text-ink-2">{t('home.togetherDays', { n: togetherDays(together.date, h.today) })}</span>
      } />
      {next.length === 0 && <Empty>{t('anniv.empty')}</Empty>}
      <div className="flex flex-col">
        {next.map((a) => (
          <div key={a.id} className="flex items-center gap-3 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-peach-soft text-terra">
              {a.kind === 'birthday' ? <Cake size={16} /> : <Heart size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px]">{a.title}</p>
              <p className="text-[12px] text-ink-2">{formatDay(a.next)}</p>
            </div>
            <span className="shrink-0 text-[15px] font-bold tabular-nums text-terra-2">{dDayLabel(a.daysLeft)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Today's daycare meals from the uploaded monthly sheet. Dinner ideas go out in the 07:30 morning briefing. */
export function DinnerCard({ className = '' }: { className?: string }) {
  const h = useHousehold()
  const m = h.todayMenu
  const rows: [string, string[]][] = m
    ? [['menu.lunch', m.lunch], ['menu.morningSnack', m.morningSnack], ['menu.afternoonSnack', m.afternoonSnack]]
    : []
  const shown = rows.filter(([, items]) => items?.length)
  return (
    <Card className={className}>
      <CardHeader title={t('dinner.cardTitle')} icon={<UtensilsCrossed size={17} className="text-terra" />} />
      {shown.length ? (
        <div className="flex flex-col gap-1.5 text-[14px] leading-relaxed">
          {shown.map(([key, items]) => (
            <p key={key}>
              <span className="mr-2 inline-block min-w-[4.5rem] font-semibold text-wisteria">{t(key)}</span>
              <span className="text-ink">{items.join(', ')}</span>
            </p>
          ))}
        </div>
      ) : <Empty>{t('dinner.noMenu')}</Empty>}
    </Card>
  )
}

export function KidsnoteCard({ className = '' }: { className?: string }) {
  const h = useHousehold()
  const items = h.todos
    .filter((x) => x.source === 'kidsnote' && x.date && x.date >= h.today && !x.done)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .slice(0, 4)
  const lastBatch = items.find((x) => x.kidsnoteBatchId)?.kidsnoteBatchId
  return (
    <Card className={className}>
      <CardHeader title={t('kidsnote.cardTitle')} action={(
        <div className="flex items-center gap-3">
          {lastBatch && (
            <button type="button" className="flex items-center gap-1 text-[12px] font-semibold text-ink-2" onClick={() => undoKidsnoteBatch(lastBatch)}>
              <Undo2 size={14} />
              {t('kidsnote.undoLast')}
            </button>
          )}
          <KidsnoteHistoryButton />
        </div>
      )} />
      {items.length === 0 && <Empty>{t('kidsnote.empty')}</Empty>}
      {items.map((x) => (
        <div key={x.id} className="py-2">
          <div className="flex items-baseline gap-2">
            <span className="w-16 shrink-0 text-[12px] font-semibold text-wisteria">{relativeDay(x.date!, h.today)}</span>
            <span className="text-[15px]">{x.title.replace(t('kidsnote.eventPrefix'), '').trim()}</span>
          </div>
          {!!x.prepItems?.length && (
            <div className="mt-1 flex flex-wrap gap-1 pl-[72px]">
              {x.prepItems.map((p) => (
                <Pill key={p.name} tone={p.source === 'inferred' ? 'ai' : 'sage'}>
                  {p.name}
                  {p.source === 'inferred' && <span className="opacity-70">{t('badge.suggested')}</span>}
                </Pill>
              ))}
            </div>
          )}
        </div>
      ))}
    </Card>
  )
}
