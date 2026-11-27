import { Check, ChevronDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export type PickerOption = {
  value: string
  label: string
  /** Optional second line shown under the label in the list. */
  hint?: string
  disabled?: boolean
}

export type PickerProps = {
  options: PickerOption[]
  value: string
  onChange: (value: string) => void
  /** Shown on the field when nothing matches `value`. */
  placeholder?: string
  /** Title at the top of the popup; defaults to the field's aria-label. */
  title?: string
  pageSize?: number
  disabled?: boolean
  invalid?: boolean
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
  /** Extra content under the list (e.g. a "create new" action). */
  footer?: ReactNode
}


/**
 * The text label shown next to the field (wrapping <label>, <label for>, or the span
 * above it in a field group), used as the dialog title when none is given.
 */
function visibleLabel(el: HTMLElement | null): string | null {
  if (!el) return null
  const text =
    el.closest('label')?.querySelector('span')?.textContent ??
    (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null) ??
    el.parentElement?.querySelector(':scope > span')?.textContent ??
    null
  const clean = text?.replace(/\*/g, '').trim()
  return clean || null
}

/**
 * Field that opens a popup with a search bar and a paginated list of options.
 * Keyboard: ↑/↓ move, Enter picks, PageUp/PageDown change page, Esc closes.
 * Opens as a centred dialog over a blurred backdrop (portalled, so dialogs never clip it).
 */
export function Picker({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  title,
  pageSize = 8,
  disabled,
  invalid,
  id,
  name,
  className,
  'aria-label': ariaLabel,
  footer,
}: PickerProps) {
  const listId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [active, setActive] = useState(0)
  const [fieldLabel, setFieldLabel] = useState<string | null>(null)

  const selected = options.find((o) => o.value === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q) || o.value.toLowerCase() === q)
  }, [options, query])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageItems = filtered.slice(page * pageSize, page * pageSize + pageSize)

  const openPopup = () => {
    if (disabled) return
    // Start on the page that holds the current value.
    const idx = Math.max(0, options.findIndex((o) => o.value === value))
    setQuery('')
    setPage(Math.floor(idx / pageSize))
    setActive(idx % pageSize)
    setFieldLabel(visibleLabel(trigger.current))
    setOpen(true)
  }

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }

  const pick = (o: PickerOption) => {
    if (o.disabled) return
    if (o.value !== value) onChange(o.value)
    close()
  }

  useLayoutEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  const go = (p: number) => {
    setPage(Math.min(Math.max(0, p), pages - 1))
    setActive(0)
  }

  const onKey = (e: KeyboardEvent) => {
    // Escape is handled by the capturing listener below.
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (active < pageItems.length - 1) setActive(active + 1)
      else if (page < pages - 1) go(page + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (active > 0) setActive(active - 1)
      else if (page > 0) {
        setPage(page - 1)
        setActive(pageSize - 1)
      }
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      go(page + 1)
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      go(page - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = pageItems[active]
      if (o) pick(o)
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  // Esc closes only the popup: caught in the capture phase so an enclosing Dialog never sees it.
  useEffect(() => {
    if (!open) return
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    document.addEventListener('keydown', onEsc, true)
    return () => document.removeEventListener('keydown', onEsc, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const from = filtered.length === 0 ? 0 : page * pageSize + 1
  const to = Math.min(filtered.length, (page + 1) * pageSize)
  const heading = title ?? ariaLabel ?? fieldLabel ?? undefined

  return (
    <>
      <button
        ref={trigger}
        id={id}
        name={name}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openPopup())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            openPopup()
          }
        }}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-lg border bg-popover/80 px-3 text-left text-sm outline-none transition focus:border-ring focus:ring-4 focus:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive',
          open && 'border-ring ring-4 ring-ring/15',
          className,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', (!selected || selected.value === '') && 'text-muted-foreground')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open &&
        createPortal(
          // Centred dialog over a blurred backdrop; clicking the backdrop closes it.
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close()
            }}
          >
          <div
            ref={popup}
            role="dialog"
            aria-modal="true"
            aria-label={heading ?? 'Choose an option'}
            onKeyDown={onKey}
            className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--glass-edge)] bg-popover text-popover-foreground shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-4">
              <h2 className="text-base font-medium">{heading ?? 'Choose an option'}</h2>
              <button type="button" onClick={() => close()} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <div className="p-3 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setPage(0)
                    setActive(0)
                  }}
                  placeholder="Search…"
                  aria-label="Search options"
                  aria-controls={listId}
                  aria-activedescendant={pageItems[active] ? `${listId}-${active}` : undefined}
                  className="h-9 w-full rounded-lg border bg-background/60 pr-8 pl-9 text-sm outline-none focus:border-ring"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setPage(0)
                      searchRef.current?.focus()
                    }}
                    aria-label="Clear search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            <ul id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
              {pageItems.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches for “{query}”.</li>
              ) : (
                pageItems.map((o, i) => {
                  const isSel = o.value === value
                  return (
                    <li
                      key={`${o.value}-${i}`}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={isSel}
                      aria-disabled={o.disabled || undefined}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(o)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm',
                        i === active && 'bg-secondary',
                        isSel && o.value !== '' && 'font-medium text-primary',
                        o.disabled && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate', o.value === '' && !isSel && 'text-muted-foreground')}>{o.label}</span>
                        {o.hint && <span className="block truncate text-xs font-normal text-muted-foreground">{o.hint}</span>}
                      </span>
                      {isSel && <Check className={cn('size-4 shrink-0', o.value === '' && 'text-muted-foreground')} />}
                    </li>
                  )
                })
              )}
            </ul>

            {(pages > 1 || filtered.length > 0) && (
              <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {from}–{to} of {filtered.length}
                </span>
                {pages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => go(page - 1)}
                      disabled={page === 0}
                      aria-label="Previous page"
                      className="rounded-full p-1 hover:bg-secondary disabled:opacity-30"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="min-w-12 text-center tabular-nums">
                      {page + 1} / {pages}
                    </span>
                    <button
                      type="button"
                      onClick={() => go(page + 1)}
                      disabled={page >= pages - 1}
                      aria-label="Next page"
                      className="rounded-full p-1 hover:bg-secondary disabled:opacity-30"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
            {footer && <div className="border-t p-2">{footer}</div>}
          </div>
          </div>,
          document.body,
        )}
    </>
  )
}
