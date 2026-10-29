import { Check, X } from 'lucide-react'
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Owner } from '../../shared/types'
import { t } from '../copy'

export function Card({ children, className = '', ai = false }: { children: ReactNode; className?: string; ai?: boolean }) {
  return (
    <section
      className={`rounded-[var(--radius-card)] p-5 ${ai ? 'ai-border' : 'bg-card border border-line shadow-[var(--shadow-card)]'} ${className}`}
    >
      {children}
    </section>
  )
}

export function CardHeader({ title, icon, action }: { title: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-center gap-2 text-[17px] font-semibold tracking-tight text-ink">
        {icon}
        <span className="truncate">{title}</span>
      </h2>
      {action}
    </div>
  )
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px] border-[1.5px] transition-colors ${
        checked ? 'border-sage bg-sage text-white' : 'border-ink-3 bg-white'
      }`}
    >
      {checked && <Check size={15} strokeWidth={3} />}
    </button>
  )
}

const OWNER_STYLE: Record<Owner, string> = {
  husband: 'bg-sage-soft text-sage',
  wife: 'bg-peach-soft text-terra-2',
  both: 'bg-sand text-ink',
}

export function OwnerBadge({ owner, name }: { owner: Owner; name: string }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${OWNER_STYLE[owner]}`}>{name}</span>
}

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ai' | 'terra' | 'sage' }) {
  const cls = {
    muted: 'bg-muted text-ink-2',
    ai: 'bg-lavender/50 text-wisteria',
    terra: 'bg-peach-soft text-terra-2',
    sage: 'bg-sage-soft text-sage',
  }[tone]
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'urgent' | 'ghost' | 'soft' }

export function Button({ variant = 'primary', className = '', ...p }: BtnProps) {
  const cls = {
    primary: 'bg-sage text-white',
    urgent: 'bg-terra text-white',
    ghost: 'bg-transparent text-ink-2',
    soft: 'bg-muted text-ink',
  }[variant]
  return (
    <button
      {...p}
      className={`inline-flex h-12 items-center justify-center gap-1.5 rounded-full px-5 text-[15px] font-semibold transition-transform active:scale-[0.98] disabled:opacity-40 ${cls} ${className}`}
    />
  )
}

export function IconButton({ label, children, className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...p}
      aria-label={label}
      title={label}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-muted ${className}`}
    >
      {children}
    </button>
  )
}

export function Field({ label, ...p }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-[13px] font-semibold text-ink-2">{label}</span>}
      <input
        {...p}
        className={`h-12 w-full rounded-[var(--radius-field)] border border-sand bg-white px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-sage focus:ring-[1.5px] focus:ring-sage ${p.className ?? ''}`}
      />
    </label>
  )
}

export function Segmented<T extends string>({
  value, options, onChange,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-full bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-9 flex-1 rounded-full px-3 text-[13px] font-semibold transition-colors ${
            value === o.value ? 'bg-white text-ink shadow-sm' : 'text-ink-2'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function OwnerPicker({ value, onChange, names }: { value: Owner; onChange: (o: Owner) => void; names: Record<Owner, string> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">{t('field.owner')}</span>
      <Segmented value={value} onChange={onChange} options={(['husband', 'wife', 'both'] as Owner[]).map((o) => ({ value: o, label: names[o] }))} />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-center text-[13px] text-ink-2">{children}</p>
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  // Portal: a parent with backdrop-filter (the sticky header) would otherwise trap position: fixed.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="pb-safe max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-card)] bg-card p-5 shadow-[var(--shadow-sheet)] md:rounded-[var(--radius-card)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[18px] font-semibold">{title}</h3>
          <IconButton label={t('action.close')} onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex min-h-12 items-center gap-3 py-1.5 ${className}`}>{children}</div>
}
