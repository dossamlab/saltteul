import { Bell, CalendarDays, Check, CloudSun, LogOut, RefreshCw, School, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { IntegrationState } from '../../shared/types'
import { logOut } from '../auth/session'
import { KidsnoteHistoryButton } from '../components/KidsnoteHistory'
import { LocationCard } from '../components/LocationCard'
import { Button, Card, CardHeader, Field, Pill } from '../components/ui'
import { t } from '../copy'
import { connectKidsnote, refreshNow, updateMyName, updateSettings } from '../data/actions'
import { useHousehold } from '../data/store'
import { usingEmulators } from '../firebase'
import { enablePush, type PushResult } from '../pwa/push'

function StatusRow({ icon, name, state }: { icon: ReactNode; name: string; state?: IntegrationState }) {
  const ok = state?.lastSuccessAt && (state.consecutiveFailures ?? 0) === 0
  const failing = (state?.consecutiveFailures ?? 0) > 0
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="text-sage">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px]">{name}</p>
        <p className="text-[12px] text-ink-2">
          {state?.lastSuccessAt
            ? t('settings.lastSuccess', { time: new Date(state.lastSuccessAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })
            : t('settings.neverRan')}
        </p>
      </div>
      <Pill tone={failing ? 'terra' : ok ? 'sage' : 'muted'}>
        {failing ? t('settings.failing', { n: state!.consecutiveFailures }) : ok ? t('settings.ok') : t('settings.waiting')}
      </Pill>
    </div>
  )
}

/** Explicit save with visible result, so it is clear whether a change was stored. */
function SaveButton({ dirty, onSave }: { dirty: boolean; onSave: () => Promise<unknown> }) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const save = async () => {
    setStatus('saving')
    try {
      await onSave()
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }
  const shown = dirty && status === 'saved' ? 'idle' : status
  return (
    <div className="flex items-center gap-3">
      <Button className="h-11 px-6" disabled={!dirty || status === 'saving'} onClick={save}>{t('action.save')}</Button>
      {shown === 'saved' && <span className="flex items-center gap-1 text-[13px] font-semibold text-sage"><Check size={16} />{t('settings.saved')}</span>}
      {shown === 'error' && <span className="text-[13px] font-semibold text-terra-2">{t('settings.saveFailed')}</span>}
      {dirty && shown === 'idle' && <span className="text-[12px] text-ink-2">{t('settings.unsaved')}</span>}
    </div>
  )
}

/**
 * The child's class for center notices. "" follows the class Kids Note has on record; the list comes from the server's
 * last Kids Note read (integrations/kidsnote).
 */
function KidsnoteClassPicker({ state }: { state?: IntegrationState }) {
  const h = useHousehold()
  const saved = h.settings.kidsnoteClassId ?? ''
  const [value, setValue] = useState(saved)
  const classes = state?.classes ?? []
  if (!classes.length) return <p className="text-[12px] text-ink-2">{t('settings.kidsnoteClassNone')}</p>
  const detected = classes.find((c) => c.id === state?.detectedClassId)?.name
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('settings.kidsnoteClass')}</span>
        <select value={value} onChange={(e) => setValue(e.target.value)}
          className="h-12 w-full rounded-[var(--radius-field)] border border-sand bg-white px-3 text-[15px] text-ink outline-none focus:border-sage focus:ring-[1.5px] focus:ring-sage">
          <option value="">{detected ? t('settings.kidsnoteClassAuto', { name: detected }) : t('settings.kidsnoteClassAutoUnknown')}</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <p className="text-[12px] text-ink-2">{t('settings.kidsnoteClassHint')}</p>
      <SaveButton dirty={value !== saved} onSave={() => updateSettings(h.hid, { kidsnoteClassId: value || null })} />
    </div>
  )
}

export function SettingsScreen({ wide = false }: { wide?: boolean }) {
  const h = useHousehold()
  const [myName, setMyName] = useState(h.me?.displayName ?? '')
  const [family, setFamily] = useState(h.settings.familyName)
  const [calendarId, setCalendarId] = useState(h.settings.calendarId ?? '')
  const [pushState, setPushState] = useState<PushResult | null>(null)
  const [kn, setKn] = useState({ id: '', pw: '', busy: false, msg: '' })
  const state = (name: IntegrationState['name']) => h.integrations.find((i) => (i as unknown as { id: string }).id === name)

  const [refresh, setRefresh] = useState({ busy: false, msg: '' })
  const runRefresh = async () => {
    setRefresh({ busy: true, msg: '' })
    try {
      const { data } = await refreshNow()
      const failed = Object.entries(data).filter(([, r]) => r === 'failed').map(([k]) => t(`settings.conn.${k}`))
      setRefresh({ busy: false, msg: failed.length ? t('settings.refreshPartial', { names: failed.join(', ') }) : t('settings.refreshDone') })
    } catch {
      setRefresh({ busy: false, msg: t('settings.refreshFailed') })
    }
  }

  const connect = async () => {
    setKn({ ...kn, busy: true, msg: '' })
    try {
      const { data } = await connectKidsnote(kn.id.trim(), kn.pw)
      setKn({ id: '', pw: '', busy: false, msg: t('kidsnote.connected', { n: data.children.length }) })
    } catch (e) {
      const code = (e as { code?: string }).code ?? ''
      const msg = code.endsWith('failed-precondition') ? t('kidsnote.connect2fa')
        : code.endsWith('unavailable') ? t('kidsnote.connectUnavailable')
        : t('kidsnote.connectFailed')
      setKn({ ...kn, pw: '', busy: false, msg })
    }
  }

  // PC: two columns (profile, alerts, weather / calendar, Kids Note, connections). Phone and tablet: one column.
  const col = `flex flex-col ${wide ? 'gap-5' : 'gap-4'}`
  return (
    <div className={wide ? 'mx-auto grid max-w-[1200px] grid-cols-2 items-start gap-5' : 'flex flex-col gap-4'}>
      <div className={col}>
        <Card>
          <CardHeader title={t('settings.profile')} />
          <div className="flex flex-col gap-3">
            <Field label={t('settings.myName')} value={myName} onChange={(e) => setMyName(e.target.value)} />
            <Field label={t('settings.familyName')} value={family} placeholder={t('app.defaultFamily')} onChange={(e) => setFamily(e.target.value)} />
            <p className="text-[12px] text-ink-2">{t('settings.signedInAs', { email: h.me?.email ?? '' })}</p>
            <SaveButton
              dirty={(myName.trim() !== (h.me?.displayName ?? '') && !!myName.trim()) || family.trim() !== h.settings.familyName}
              onSave={async () => {
                if (myName.trim()) await updateMyName(h.hid, h.uid, myName)
                await updateSettings(h.hid, { familyName: family.trim() })
              }}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title={t('settings.notifications')} icon={<Bell size={18} className="text-sage" />} />
          <p className="mb-3 text-[13px] text-ink-2">{t('settings.notificationsHint')}</p>
          <Button className="w-full" onClick={async () => setPushState(await enablePush(h.hid, h.uid))}>{t('settings.enablePush')}</Button>
          {pushState && <p className="mt-2 text-[13px] text-ink-2">{t(`push.${pushState}`)}</p>}
          <p className="mt-3 text-[12px] text-ink-2">
            {t('settings.briefingTimes', { morning: h.settings.briefingTimes.morning, evening: h.settings.briefingTimes.evening })}
          </p>
        </Card>

        <LocationCard />
      </div>

      <div className={col}>
        <Card>
          <CardHeader title={t('settings.calendar')} icon={<CalendarDays size={18} className="text-sage" />} />
          <p className="mb-3 text-[13px] text-ink-2">{t('settings.calendarHint')}</p>
          <div className="flex flex-col gap-3">
            <Field label={t('settings.calendarId')} value={calendarId} placeholder="xxxx@group.calendar.google.com" onChange={(e) => setCalendarId(e.target.value)} />
            <SaveButton
              dirty={calendarId.trim() !== (h.settings.calendarId ?? '')}
              onSave={() => updateSettings(h.hid, { calendarId: calendarId.trim() || null })}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title={t('settings.kidsnote')} icon={<School size={18} className="text-wisteria" />} />
          <p className="mb-3 text-[13px] text-ink-2">{t('settings.kidsnoteHint')}</p>
          <div className="flex flex-col gap-3">
            <Field label={t('settings.kidsnoteId')} autoComplete="off" value={kn.id} onChange={(e) => setKn({ ...kn, id: e.target.value })} />
            <Field label={t('settings.kidsnotePw')} type="password" autoComplete="off" value={kn.pw} onChange={(e) => setKn({ ...kn, pw: e.target.value })} />
            <Button variant="soft" disabled={!kn.id.trim() || !kn.pw || kn.busy} onClick={connect}>{t('settings.kidsnoteConnect')}</Button>
            {kn.msg && <p className="text-[13px] text-ink-2">{kn.msg}</p>}
            <KidsnoteClassPicker state={state('kidsnote')} />
            <KidsnoteHistoryButton variant="soft" />
          </div>
        </Card>

        <Card>
          <CardHeader title={t('settings.connections')} />
          <StatusRow icon={<Sparkles size={18} />} name={t('settings.conn.claude')} state={state('claude')} />
          <StatusRow icon={<CalendarDays size={18} />} name={t('settings.conn.calendar')} state={state('calendar')} />
          <StatusRow icon={<School size={18} />} name={t('settings.conn.kidsnote')} state={state('kidsnote')} />
          <StatusRow icon={<CloudSun size={18} />} name={t('settings.conn.weather')} state={state('weather')} />
          <Button variant="soft" className="mt-3 w-full" disabled={refresh.busy} onClick={runRefresh}>
            <RefreshCw size={18} className={refresh.busy ? 'animate-spin' : ''} />
            {refresh.busy ? t('settings.refreshing') : t('settings.refreshNow')}
          </Button>
          {refresh.msg && <p className="mt-2 text-[13px] text-ink-2">{refresh.msg}</p>}
          {usingEmulators && <p className="mt-2 text-[12px] text-terra-2">{t('settings.emulatorNotice')}</p>}
        </Card>

        <Button variant="ghost" onClick={() => logOut()}><LogOut size={18} />{t('settings.signOut')}</Button>
      </div>
    </div>
  )
}
