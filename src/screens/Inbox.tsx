import { BellRing } from 'lucide-react'
import { Card, CardHeader, Empty } from '../components/ui'
import { t } from '../copy'
import { markNudgeRead } from '../data/actions'
import { useHousehold } from '../data/store'

export function InboxScreen() {
  const h = useHousehold()
  return (
    <Card>
      <CardHeader title={t('inbox.title')} icon={<BellRing size={18} className="text-terra" />} />
      {h.nudges.length === 0 && <Empty>{t('inbox.empty')}</Empty>}
      <div className="divide-y divide-line">
        {h.nudges.map((n) => (
          <button key={n.id} type="button" onClick={() => !n.read && markNudgeRead(h.hid, n.id)} className="flex w-full gap-3 py-3 text-left">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-terra'}`} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">
                {n.targetTitle
                  ? t('inbox.itemWithTarget', { name: h.nameOf(n.from), title: n.targetTitle })
                  : t('inbox.item', { name: h.nameOf(n.from) })}
              </p>
              {n.message && <p className="mt-0.5 text-[14px] text-ink-2">{n.message}</p>}
              <p className="mt-1 text-[11px] text-ink-3">
                {new Date(n.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </button>
        ))}
      </div>
    </Card>
  )
}
