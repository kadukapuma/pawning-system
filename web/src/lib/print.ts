import { useEffect } from 'react'

/*
 * Printing goes through one preview popup (components/print/PrintPreviewHost):
 *  - openPrintPreview(url): a /print/... document page loaded in an iframe;
 *  - printCurrentPage(): a snapshot of the page on screen (reports, cash book…).
 * Print pages inside the popup do not auto-print; they post "print-ready" once their
 * data is loaded so the popup can enable its Print button.
 */

export type PrintRequest = { kind: 'url'; url: string; title: string } | { kind: 'html'; html: string; title: string }

type Listener = (r: PrintRequest) => void
let listener: Listener | null = null

/** Registered by PrintPreviewHost; returns an unsubscribe. */
export function onPrintRequest(l: Listener) {
  listener = l
  return () => {
    if (listener === l) listener = null
  }
}

/** Running inside the preview iframe. */
export const isEmbedded = () => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

/** Show a /print/... document page in the preview popup. */
export function openPrintPreview(url: string, title = 'Print preview') {
  if (listener) listener({ kind: 'url', url, title })
  else window.open(url, '_blank')
}

/**
 * Preview the page on screen. Takes a static copy of the main content (or of the element
 * marked `data-print-root`) with the app's styles, minus anything hidden in print.
 */
export function printCurrentPage(title = document.title) {
  const root = document.querySelector<HTMLElement>('[data-print-root]') ?? document.querySelector<HTMLElement>('main')
  if (!root || !listener) {
    window.print()
    return
  }
  const clone = root.cloneNode(true) as HTMLElement
  // Form values are not part of the markup; copy them so filters show what was picked.
  const src = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((el, i) => {
    const s = src[i]
    if (!s) return
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) el.toggleAttribute('checked', (s as HTMLInputElement).checked)
    else el.setAttribute('value', s.value)
    if (el instanceof HTMLTextAreaElement) el.textContent = s.value
  })
  // Dropdowns (Picker buttons) keep their chosen value as plain text.
  clone.querySelectorAll('button[aria-haspopup]').forEach((b) => {
    const span = document.createElement('span')
    span.className = 'inline-block rounded-md border px-2 py-1 text-sm'
    span.textContent = b.textContent
    b.replaceWith(span)
  })
  // Drop screen-only parts: buttons, and anything marked hidden in print.
  clone.querySelectorAll('button, [role="button"], .no-print, [class*="print:hidden"], [data-no-print]').forEach((el) => el.remove())

  const styles = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((n) => n.outerHTML).join('\n')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="${location.origin}/">${styles}
<style>
  html, body { background: #fff !important; color: #111; }
  body { padding: 16px; }
  .glass { background: #fff !important; backdrop-filter: none !important; box-shadow: none !important; border: 1px solid #e5e5e5 !important; }
  @media print { body { padding: 0; } }
</style></head><body>${clone.outerHTML}</body></html>`
  listener({ kind: 'html', html, title })
}

/**
 * For /print/... pages: on their own tab they print as soon as `ready`; inside the
 * preview popup they tell the parent they are ready instead.
 */
export function useAutoPrint(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    if (isEmbedded()) {
      window.parent.postMessage({ type: 'print-ready' }, location.origin)
      return
    }
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [ready])
}
