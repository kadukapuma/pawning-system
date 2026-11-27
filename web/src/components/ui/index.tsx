import { Info, Loader2, X } from 'lucide-react'
import {
  Children,
  forwardRef,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/utils'
import { Picker, type PickerOption } from './Picker'

export { Picker, type PickerOption } from './Picker'

/* ---------------------------------------------------------------- Button */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
  size?: 'sm' | 'md'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition active:scale-[0.98] disabled:opacity-60',
        size === 'sm' ? 'h-8 px-3.5 text-xs' : 'h-10 px-5 text-sm',
        variant === 'primary' && 'bg-primary text-primary-foreground shadow-[0_6px_16px_-6px_var(--primary)] hover:opacity-90',
        variant === 'accent' && 'bg-accent text-accent-foreground hover:opacity-90',
        variant === 'secondary' && 'border border-[var(--glass-edge)] bg-card shadow-sm backdrop-blur hover:bg-popover',
        variant === 'ghost' && 'hover:bg-secondary',
        variant === 'danger' && 'bg-destructive text-white hover:opacity-90',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
})

/* ---------------------------------------------------------------- Fields */

const fieldBase =
  'w-full rounded-lg border bg-popover/80 px-3 text-sm outline-none transition focus:border-ring focus:ring-4 focus:ring-ring/15 disabled:opacity-60 aria-[invalid=true]:border-destructive'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...rest} />
})

/** Text content of option children such as `{b.code} · {b.name}`. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** Flattens <option> children (through fragments and arrays) into picker options. */
function optionsFrom(children: ReactNode): PickerOption[] {
  const out: PickerOption[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return
    if (child.type === Fragment) {
      out.push(...optionsFrom(child.props.children))
      return
    }
    if (child.type !== 'option') return
    const label = textOf(child.props.children)
    // Like a native <option>, a missing value falls back to the text.
    out.push({ value: child.props.value != null ? String(child.props.value) : label, label, disabled: child.props.disabled })
  })
  return out
}

type SelectProps = {
  value?: string | number
  onChange?: (e: { target: { value: string; name?: string }; currentTarget: { value: string; name?: string } }) => void
  disabled?: boolean
  className?: string
  id?: string
  name?: string
  title?: string
  children?: ReactNode
  'aria-label'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

/**
 * Drop-in replacement for a native <select>: same `value` / `onChange(e)` / <option> children,
 * but opens the searchable, paginated Picker popup. Use <Picker> directly for new code.
 */
export function Select({ value, onChange, disabled, className, id, name, title, children, 'aria-label': ariaLabel, 'aria-invalid': ariaInvalid }: SelectProps) {
  const options = optionsFrom(children)
  const current = value == null ? '' : String(value)
  return (
    <Picker
      options={options}
      // A native select with no matching option shows its first option.
      value={options.some((o) => o.value === current) ? current : (options[0]?.value ?? '')}
      onChange={(v) => {
        const target = { value: v, name }
        onChange?.({ target, currentTarget: target })
      }}
      placeholder={options[0]?.label}
      disabled={disabled}
      invalid={ariaInvalid === true || ariaInvalid === 'true'}
      id={id}
      name={name}
      title={title}
      aria-label={ariaLabel}
      className={className}
    />
  )
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2', className)} {...rest} />
})

/** Label + control + error/hint. */
export function Field({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <label className={cn('block space-y-1 text-sm', className)}>
      <span className="font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="block text-xs text-destructive">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  )
}

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-[var(--primary)]" {...rest} />
      {label}
    </label>
  )
}

/* ---------------------------------------------------------------- InfoTip */

/**
 * A small "i" button that shows help text on hover, keyboard focus or tap.
 * The popover is position: fixed so scrolling dialogs never clip it.
 */
export function InfoTip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null)

  const show = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const width = 288
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8)
    const above = r.top > 200
    setPos({ left, top: above ? r.top - 8 : r.bottom + 8, above })
  }
  const hide = () => setPos(null)

  useEffect(() => {
    if (!pos) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), hide())
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', hide, true)
    }
  }, [pos])

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`What is “${label}”?`}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault()
          if (pos) hide()
          else show()
        }}
        className={cn(
          'inline-grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {pos && (
        <span
          id={id}
          role="tooltip"
          style={{ left: pos.left, top: pos.top, width: 288 }}
          className={cn(
            'pointer-events-none fixed z-[60] rounded-lg border bg-popover px-3 py-2 text-xs leading-relaxed font-normal text-popover-foreground shadow-lg',
            pos.above && '-translate-y-full',
          )}
        >
          <span className="mb-0.5 block font-semibold">{label}</span>
          {children}
        </span>
      )}
    </>
  )
}

/* ---------------------------------------------------------------- Layout */

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-light tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('glass rounded-2xl', className)}>{children}</div>
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary'
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        tone === 'neutral' && 'bg-secondary text-secondary-foreground',
        tone === 'success' && 'bg-success/15 text-success',
        tone === 'warning' && 'bg-warning/20 text-accent-foreground',
        tone === 'danger' && 'bg-destructive/15 text-destructive',
        tone === 'primary' && 'bg-primary/15 text-primary',
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-muted-foreground', className)} />
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-14 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}

/* ---------------------------------------------------------------- Table */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn('border-b px-3 py-2.5 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase', className)}>
      {children}
    </th>
  )
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn('border-b border-border/60 px-3 py-2.5 align-middle', className)}>
      {children}
    </td>
  )
}

/* ---------------------------------------------------------------- Dialog */

export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/25 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'w-full rounded-2xl border border-[var(--glass-edge)] bg-popover shadow-2xl',
          size === 'sm' && 'max-w-md',
          size === 'md' && 'max-w-xl',
          size === 'lg' && 'max-w-3xl',
          size === 'xl' && 'max-w-5xl',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-secondary">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Pagination */

export type PageMeta = { current_page: number; last_page: number; total: number; from: number | null; to: number | null }

export function Pagination({ meta, onPage }: { meta?: PageMeta; onPage: (p: number) => void }) {
  if (!meta || meta.last_page <= 1) return meta ? <p className="px-3 py-2 text-xs text-muted-foreground">{meta.total} record(s)</p> : null
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
      <span>
        {meta.from}–{meta.to} of {meta.total}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" disabled={meta.current_page <= 1} onClick={() => onPage(meta.current_page - 1)}>
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={meta.current_page >= meta.last_page}
          onClick={() => onPage(meta.current_page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
