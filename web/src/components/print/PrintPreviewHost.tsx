import { ExternalLink, Loader2, Printer, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui'
import { onPrintRequest, type PrintRequest } from '@/lib/print'

/** Mounted once (main.tsx): shows every print in a centred preview popup. */
export function PrintPreviewHost() {
  const [req, setReq] = useState<PrintRequest | null>(null)
  const [ready, setReady] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(
    () =>
      onPrintRequest((r) => {
        setReady(false)
        setReq(r)
      }),
    [],
  )

  // Document pages post "print-ready" once their data has loaded.
  useEffect(() => {
    if (!req) return
    const onMsg = (e: MessageEvent) => {
      if (e.origin === location.origin && e.source === frame.current?.contentWindow && e.data?.type === 'print-ready') setReady(true)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [req])

  // Esc closes the preview only (caught before any dialog underneath).
  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setReq(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [req])

  if (!req) return null

  const print = () => {
    const w = frame.current?.contentWindow
    if (!w) return
    w.focus()
    w.print()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm sm:p-6 print:hidden"
      onMouseDown={(e) => e.target === e.currentTarget && setReq(null)}
    >
      <div role="dialog" aria-modal="true" aria-label={req.title} className="flex h-full max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--glass-edge)] bg-popover shadow-2xl">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Printer className="size-4 text-muted-foreground" />
          <h2 className="mr-auto text-base font-medium">{req.title}</h2>
          {req.kind === 'url' && (
            <Button variant="ghost" size="sm" onClick={() => window.open(req.url, '_blank')}>
              <ExternalLink className="size-4" /> Open in new tab
            </Button>
          )}
          <Button size="sm" onClick={print} disabled={!ready} loading={!ready}>
            {ready && <Printer className="size-4" />} Print
          </Button>
          <button type="button" onClick={() => setReq(null)} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {/* Grey desk behind the white page, like a print preview. */}
        <div className="relative min-h-0 flex-1 bg-neutral-200 dark:bg-neutral-800">
          {!ready && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-neutral-200 text-sm text-muted-foreground dark:bg-neutral-800">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Preparing preview…
              </span>
            </div>
          )}
          <iframe
            ref={frame}
            title={req.title}
            {...(req.kind === 'url' ? { src: req.url } : { srcDoc: req.html })}
            // A snapshot is ready as soon as it has loaded; document pages say so themselves.
            onLoad={() => req.kind === 'html' && setReady(true)}
            className="mx-auto block h-full w-full max-w-[900px] bg-white shadow-lg"
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
