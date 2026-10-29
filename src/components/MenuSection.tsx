import { doc, onSnapshot } from 'firebase/firestore'
import { Camera, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Trash2, Utensils } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { addDays } from '../../shared/householdDate'
import type { MonthlyMenu } from '../../shared/types'
import { t } from '../copy'
import { extractMenu, saveMonthlyMenu } from '../data/actions'
import { daysFromRows, MENU_FIELDS, monthOf, rowsFromDays, rowsFromStored, shiftMonth, type MenuField, type MenuRow } from '../data/menu'
import { useHousehold } from '../data/store'
import { prepareUpload, UploadError } from '../data/upload'
import { db } from '../firebase'
import { formatDay } from '../format'
import { Button, Card, CardHeader, Empty, Field, IconButton, Sheet } from './ui'

type Phase =
  | { step: 'loading' }
  | { step: 'edit'; rows: MenuRow[]; saving: boolean; fromUpload: boolean }
  | { step: 'error'; message: string }

const FIELD_KEY: Record<MenuField, string> = {
  lunch: 'menu.lunch', morningSnack: 'menu.morningSnack', afternoonSnack: 'menu.afternoonSnack',
}

function errorMessage(e: unknown): string {
  if (e instanceof UploadError) {
    return e.code === 'tooLarge' ? t('quick.fileTooLarge') : e.code === 'badType' ? t('quick.fileType') : t('quick.fileDecode')
  }
  const code = (e as { code?: string }).code ?? ''
  if (code.endsWith('resource-exhausted')) return t('quick.errorBusy')
  if (code.endsWith('unavailable') || code.endsWith('deadline-exceeded')) return t('quick.errorNetwork')
  return t('menu.readFailed')
}

function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  return t('menu.month', { y, m })
}

/**
 * 「우리 집」 daycare menu: pick a month, upload that month's menu sheet, check what Claude read, save to menus/{YYYY-MM}.
 * The weekday dinner suggestion reads the day's lunch and snacks from here.
 */
export function MenuSection() {
  const h = useHousehold()
  const [month, setMonth] = useState(monthOf(h.today))
  const [stored, setStored] = useState<MonthlyMenu | null>(null)
  const [phase, setPhase] = useState<Phase | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const req = useRef(0)

  useEffect(() => {
    setStored(null)
    return onSnapshot(doc(db, `households/${h.hid}/menus/${month}`), (d) => {
      setStored(d.exists() ? ({ ...(d.data() as MonthlyMenu), id: d.id }) : null)
    }, () => setStored(null))
  }, [h.hid, month])

  const dayCount = Object.keys(stored?.days ?? {}).length
  const todayMenu = monthOf(h.today) === month ? stored?.days?.[h.today] : undefined

  const runFile = async (file: File) => {
    const id = ++req.current
    setPhase({ step: 'loading' })
    try {
      const payload = await prepareUpload(file)
      const { data } = await extractMenu({ ...payload, month })
      if (id !== req.current) return
      setPhase({ step: 'edit', rows: rowsFromDays(data.days), saving: false, fromUpload: true })
    } catch (e) {
      if (id === req.current) setPhase({ step: 'error', message: errorMessage(e) })
    }
  }

  const close = () => {
    req.current++
    setPhase(null)
  }

  const edit = phase?.step === 'edit' ? phase : null
  const setRows = (rows: MenuRow[]) => edit && setPhase({ ...edit, rows })
  const setCell = (i: number, field: MenuField, value: string) =>
    edit && setRows(edit.rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)))
  const addRow = () => {
    if (!edit) return
    const last = edit.rows.at(-1)?.date
    let date = last ? addDays(last, 1) : `${month}-01`
    if (monthOf(date) !== month) date = `${month}-01`
    setRows([...edit.rows, { date, lunch: '', morningSnack: '', afternoonSnack: '' }])
  }
  const save = async () => {
    if (!edit) return
    setPhase({ ...edit, saving: true })
    try {
      await saveMonthlyMenu(h.hid, h.uid, month, daysFromRows(edit.rows, month))
      req.current++
      setPhase(null)
    } catch {
      setPhase({ step: 'error', message: t('menu.saveFailed') })
    }
  }

  return (
    <Card>
      <CardHeader title={t('menu.title')} icon={<Utensils size={18} className="text-sage" />} />
      <div className="-mt-1 mb-2 flex items-center justify-between">
        <IconButton label={t('menu.prevMonth')} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></IconButton>
        <span className="text-[15px] font-semibold">{monthLabel(month)}</span>
        <IconButton label={t('menu.nextMonth')} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={18} /></IconButton>
      </div>
      {dayCount ? <p className="text-[13px] text-ink-2">{t('menu.count', { n: dayCount })}</p> : <Empty>{t('menu.empty')}</Empty>}
      {todayMenu && (
        <div className="mt-2 rounded-[var(--radius-field)] bg-muted px-3.5 py-3 text-[13px] leading-relaxed text-ink">
          <p className="mb-0.5 text-[12px] font-semibold text-ink-2">{t('menu.today')}</p>
          {MENU_FIELDS.filter((f) => todayMenu[f]?.length).map((f) => (
            <p key={f}><span className="text-ink-2">{t(FIELD_KEY[f])}</span> {todayMenu[f].join(', ')}</p>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="soft" className="flex-1" onClick={() => fileRef.current?.click()}><Camera size={18} />{t('menu.upload')}</Button>
        {!!dayCount && (
          <Button variant="soft" onClick={() => setPhase({ step: 'edit', rows: rowsFromStored(stored?.days), saving: false, fromUpload: false })}>
            <Pencil size={16} />{t('action.edit')}
          </Button>
        )}
      </div>
      <p className="mt-2 text-[12px] text-ink-2">{t('menu.hint')}</p>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void runFile(f)
        }} />

      <Sheet open={phase !== null} onClose={close} title={t('menu.sheetTitle', { month: monthLabel(month) })}>
        {phase?.step === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 size={28} className="animate-spin text-wisteria" />
            <p className="text-[15px] text-ink">{t('menu.reading')}</p>
          </div>
        )}
        {edit && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-ink-2">{t(edit.fromUpload ? 'menu.checkHint' : 'menu.editHint')}</p>
            {edit.rows.length === 0 && <Empty>{t('menu.nothingRead')}</Empty>}
            <div className="divide-y divide-line">
              {edit.rows.map((r, i) => (
                <div key={i} className="flex flex-col gap-2 py-3">
                  <div className="flex items-center gap-2">
                    <input type="date" value={r.date} min={`${month}-01`} max={addDays(`${shiftMonth(month, 1)}-01`, -1)}
                      aria-label={t('menu.date')}
                      onChange={(e) => edit && setRows(edit.rows.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
                      className="h-9 rounded-[var(--radius-field)] border border-sand bg-white px-2 text-[14px] text-ink" />
                    <span className="flex-1 text-[13px] text-ink-2">{r.date ? formatDay(r.date) : ''}</span>
                    <IconButton label={t('action.delete')} onClick={() => setRows(edit.rows.filter((_, j) => j !== i))}><Trash2 size={16} /></IconButton>
                  </div>
                  {MENU_FIELDS.map((f) => (
                    <Field key={f} label={t(FIELD_KEY[f])} value={r[f]} onChange={(e) => setCell(i, f, e.target.value)} />
                  ))}
                </div>
              ))}
            </div>
            <Button variant="soft" onClick={addRow}><Plus size={18} />{t('menu.addDay')}</Button>
            <div className="mt-1 flex gap-2">
              <Button variant="soft" onClick={close}>{t('action.cancel')}</Button>
              <Button className="flex-1" disabled={edit.saving} onClick={save}>
                {edit.saving && <Loader2 size={18} className="animate-spin" />}{t('action.save')}
              </Button>
            </div>
          </div>
        )}
        {phase?.step === 'error' && (
          <div className="flex flex-col gap-4">
            <p role="alert" className="rounded-[var(--radius-field)] bg-peach-soft px-3.5 py-3 text-[14px] text-terra-2">{phase.message}</p>
            <Button variant="soft" onClick={close}>{t('action.close')}</Button>
          </div>
        )}
      </Sheet>
    </Card>
  )
}
