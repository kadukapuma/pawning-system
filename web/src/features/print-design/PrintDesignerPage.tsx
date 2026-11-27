import {
  ArrowLeft, Eye, ImagePlus, Image as ImageIcon, Loader2, Maximize2, Minimize2, Minus, PanelLeftClose, PanelLeftOpen, PanelRightClose,
  PanelRightOpen, PenTool, Printer, Redo2, RotateCcw, Ruler, Save, ShieldAlert, Square, Table2, Type, Undo2, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button, Dialog, Select } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { api, errorMessage } from '@/lib/api'
import { printCurrentPage } from '@/lib/print'
import { cn } from '@/lib/utils'
import { withCommonFields, type PrintParty } from './lib/active-design'
import { DesignedDocument } from './components/designed-document'
import { DesignerCanvas } from './components/designer-canvas'
import { PropertiesPanel } from './components/properties-panel'
import { DOCUMENTS, DOCUMENT_MAP, sampleData } from './lib/catalog'
import { defaultTemplate } from './lib/defaults'
import { createElement, moveElement, newId, offPageCount, removeElement, reorderElement, scaleToPaper } from './lib/edit'
import type { DesignDocumentKey, ElementType, PrintTemplate } from './lib/types'

interface StoredDesign {
  template: PrintTemplate | null
  active: boolean
  updated_by: string | null
  updated_at: string | null
}

interface History {
  past: PrintTemplate[]
  present: PrintTemplate
  future: PrintTemplate[]
}

/** The design being edited, tied to the document it belongs to. */
interface Session {
  key: DesignDocumentKey
  history: History
  /** JSON of what is saved on the server (or of the untouched standard design). */
  saved: string
  stored: boolean
  active: boolean
  updatedBy: string | null
  company: PrintParty | null
  branch: PrintParty | null
}

const HISTORY_LIMIT = 60

/** The starting design for a document, on its standard paper unless another size is given. */
const standardDesign = (key: DesignDocumentKey, paper?: PrintTemplate['paper']) =>
  defaultTemplate(key, { ...DOCUMENT_MAP[key].paper, ...paper })

/* ---------------------------------------------------------------- confirm */

type ConfirmOptions = { title: string; message: string; confirmLabel: string; tone?: 'primary' | 'danger' }

/** Promise-based confirm built on the app Dialog. */
function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), [])
  const done = (ok: boolean) => {
    state?.resolve(ok)
    setState(null)
  }
  const dialog = (
    <Dialog
      open={!!state}
      onClose={() => done(false)}
      title={state?.title ?? ''}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => done(false)}>Cancel</Button>
          <Button variant={state?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => done(true)}>{state?.confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{state?.message}</p>
    </Dialog>
  )
  return [ask, dialog]
}

/* ---------------------------------------------------------------- page */

export function PrintDesignerPage() {
  const { can } = useAuth()
  if (!can('print_designs.manage')) {
    return (
      <div className="glass rounded-2xl p-16 text-center text-muted-foreground">
        <ShieldAlert className="mx-auto mb-3 size-8 opacity-40" />
        You need the “print_designs.manage” permission to design print layouts.
      </div>
    )
  }
  return <PrintDesigner />
}

const toolBtn = 'flex w-full items-center gap-2 rounded-lg border bg-popover px-2.5 py-1.5 text-xs font-medium transition hover:border-ring hover:bg-secondary'
const iconBtn = 'rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-30'
const toggleBtn = (on: boolean) => cn('rounded-lg border p-1.5 transition', on ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-popover text-muted-foreground hover:bg-secondary')

function PrintDesigner() {
  const [confirm, confirmDialog] = useConfirm()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [docKey, setDocKey] = useState<DesignDocumentKey>(() => {
    const k = params.get('document')
    return k && k in DOCUMENT_MAP ? (k as DesignDocumentKey) : 'pawn_ticket'
  })
  // The latest paper-size change; only offered while no other edit has happened since.
  const [paperChange, setPaperChange] = useState<{ from: PrintTemplate['paper']; result: PrintTemplate } | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [activeKeys, setActiveKeys] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'design' | 'preview'>('design')
  const [zoom, setZoom] = useState(1)
  const [snap, setSnap] = useState(1)
  const [sampleRows, setSampleRows] = useState(3)
  const [background, setBackground] = useState<{ url: string; opacity: number } | null>(null)
  const [showRulers, setShowRulers] = useState(true)
  const [showLeftTools, setShowLeftTools] = useState(true)
  const [showRightInspector, setShowRightInspector] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [printRequested, setPrintRequested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {})
      setIsFullscreen(true)
    } else {
      void document.exitFullscreen?.().catch(() => {})
      setIsFullscreen(false)
    }
  }, [])

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [design, active, index] = await Promise.all([
          api.get<{ data: StoredDesign }>(`/api/v1/admin/print-designs/${docKey}`),
          api.get<{ data: { company: PrintParty | null; branch: PrintParty | null } }>(`/api/v1/print-designs/${docKey}`),
          api.get<{ data: { document_key: string; active: boolean }[] }>('/api/v1/admin/print-designs'),
        ])
        const stored = design.data.data
        const template = stored?.template ?? standardDesign(docKey)
        if (!live) return
        setActiveKeys((index.data.data ?? []).filter((row) => row.active).map((row) => row.document_key))
        setSession({
          key: docKey,
          history: { past: [], present: template, future: [] },
          saved: JSON.stringify(template),
          stored: !!stored?.template,
          active: !!stored?.active,
          updatedBy: stored?.updated_by ?? null,
          company: active.data.data?.company ?? null,
          branch: active.data.data?.branch ?? null,
        })
      } catch (error) {
        if (live) toast.error(errorMessage(error))
      }
    })()
    return () => {
      live = false
    }
  }, [docKey, reload])

  const ready = session?.key === docKey ? session : null
  const template = ready?.history.present ?? null
  const info = DOCUMENT_MAP[docKey]
  const dirty = !!ready && JSON.stringify(ready.history.present) !== ready.saved
  const selected = template?.elements.find((element) => element.id === selectedId) ?? null
  const company = ready?.company
  const branch = ready?.branch
  const data = useMemo(() => withCommonFields(sampleData(docKey, sampleRows, company?.logo), company, branch), [docKey, sampleRows, company, branch])

  // ----- editing + undo -----
  const editHistory = useCallback((change: (history: History) => History) => {
    setSession((current) => (current ? { ...current, history: change(current.history) } : current))
  }, [])
  const apply = useCallback(
    (next: PrintTemplate) =>
      editHistory((h) => (next === h.present ? h : { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] })),
    [editHistory],
  )
  const preview = useCallback((next: PrintTemplate) => editHistory((h) => ({ ...h, present: next })), [editHistory])
  const commit = useCallback(
    (before: PrintTemplate) => editHistory((h) => ({ past: [...h.past, before].slice(-HISTORY_LIMIT), present: h.present, future: [] })),
    [editHistory],
  )
  const undo = useCallback(
    () => editHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)),
    [editHistory],
  )
  const redo = useCallback(
    () => editHistory((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)),
    [editHistory],
  )

  const add = (type: ElementType, options?: { text?: string; source?: string }) => {
    if (!template) return
    const element = createElement(template, info, type, options)
    apply({ ...template, elements: [...template.elements, element] })
    setSelectedId(element.id)
    setMode('design')
  }
  const duplicate = useCallback(() => {
    if (!template || !selected) return
    const copy = { ...structuredClone(selected), id: newId(template, selected.type), x: selected.x + 3, y: selected.y + 3 }
    apply({ ...template, elements: [...template.elements, copy] })
    setSelectedId(copy.id)
  }, [template, selected, apply])
  const remove = useCallback(() => {
    if (!template || !selected) return
    apply(removeElement(template, selected.id))
    setSelectedId(null)
  }, [template, selected, apply])

  const fitToScreen = useCallback(() => {
    if (!viewportRef.current || !ready) return
    const rect = viewportRef.current.getBoundingClientRect()
    const paperWidthPx = (ready.history.present.paper.width_mm * 96) / 25.4
    const hMm = ready.history.present.paper.height_mm > 0 ? ready.history.present.paper.height_mm : 160
    const paperHeightPx = (hMm * 96) / 25.4
    const fit = Math.min((rect.width - 64) / paperWidthPx, (rect.height - 64) / paperHeightPx, 2)
    setZoom(Math.max(0.25, Math.round(fit * 20) / 20))
  }, [ready])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (mode !== 'design' || target.closest('input, textarea, select, button[aria-haspopup], [role="dialog"]')) return
      const command = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (command && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (command && key === 'y') {
        event.preventDefault()
        redo()
      } else if (!selected || !template) {
        return
      } else if (command && key === 'd') {
        event.preventDefault()
        duplicate()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        remove()
      } else if (event.key === 'Escape') {
        setSelectedId(null)
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        const step = event.shiftKey ? 5 : snap || 0.5
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        apply(moveElement(template, selected.id, selected.x + dx, selected.y + dy))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, selected, template, snap, apply, undo, redo, duplicate, remove])

  // ----- paper size -----
  const resized = template && paperChange?.result === template ? paperChange.from : null
  const offPage = template ? offPageCount(template) : 0
  const changePaper = (paper: PrintTemplate['paper']) => {
    if (!template) return
    const next = { ...template, paper }
    if (template.paper.width_mm !== paper.width_mm || template.paper.height_mm !== paper.height_mm) {
      setPaperChange({ from: resized ?? template.paper, result: next })
    }
    apply(next)
  }
  const rebuildForPaper = async () => {
    if (!template) return
    apply(standardDesign(docKey, template.paper))
    setSelectedId(null)
  }

  // ----- leaving / printing -----
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Test print: switch to preview, then open the print preview popup with just the document.
  useEffect(() => {
    if (!printRequested || mode !== 'preview') return
    const timer = window.setTimeout(() => {
      setPrintRequested(false)
      printCurrentPage(`Test print — ${info.label}`)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [printRequested, mode, info.label])

  const discardOk = async () =>
    !dirty ||
    (await confirm({ title: 'Discard unsaved changes?', message: `Your changes to “${info.label}” have not been saved.`, confirmLabel: 'Discard', tone: 'danger' }))

  // Back button: return to where the user came from (or the dashboard), after the unsaved-changes check.
  const leave = async () => {
    if (!(await discardOk())) return
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/')
  }

  const changeDocument = async (key: DesignDocumentKey) => {
    if (key === docKey || !(await discardOk())) return
    setSelectedId(null)
    setBackground(null)
    setSession(null)
    setDocKey(key)
  }

  const save = async (active: boolean) => {
    if (!template) return
    if (active && !ready?.active) {
      const ok = await confirm({
        title: 'Print with this design?',
        message: `Every branch will print “${info.label}” with your design. Check the preview and a test print first.`,
        confirmLabel: 'Use this design',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const res = await api.put<{ data: { updated_by: string | null }; message?: string }>(`/api/v1/admin/print-designs/${docKey}`, { active, template })
      setSession((current) => (current ? { ...current, saved: JSON.stringify(template), stored: true, active, updatedBy: res.data.data.updated_by } : current))
      setActiveKeys((keys) => (active ? [...new Set([...keys, docKey])] : keys.filter((key) => key !== docKey)))
      toast.success(res.data.message || 'Design saved.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const removeDesign = async () => {
    const ok = await confirm({
      title: 'Delete this design?',
      message: `“${info.label}” will print with the standard layout again and your design is deleted.`,
      confirmLabel: 'Delete design',
      tone: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await api.delete<{ data: { message?: string } }>(`/api/v1/admin/print-designs/${docKey}`)
      toast.success(res.data.data?.message || 'Design removed.')
      setSelectedId(null)
      setSession(null)
      setReload((n) => n + 1)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const startOver = async () => {
    const ok = await confirm({
      title: 'Start again from the standard design?',
      message: 'All blocks are put back to the starting design on the standard paper size. You can undo this.',
      confirmLabel: 'Start again',
      tone: 'danger',
    })
    if (!ok) return
    apply(standardDesign(docKey))
    setSelectedId(null)
  }

  const chooseBackground = (file: File | undefined) => {
    if (!file) return
    setBackground({ url: URL.createObjectURL(file), opacity: 0.5 })
  }
  useEffect(() => {
    const url = background?.url
    return () => {
      if (url) window.setTimeout(() => URL.revokeObjectURL(url), 0)
    }
  }, [background?.url])

  const status = ready?.active ? 'live' : ready?.stored ? 'draft' : 'standard'

  return (
    // Full-window workspace (its own route, outside the app layout).
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-popover">
      {confirmDialog}

      {/* ---------------------------------------------------------------- toolbar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 overflow-x-auto border-b px-3 select-none">
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void leave()}
            title="Back to the system"
            aria-label="Back to the system"
            className="grid size-8 shrink-0 place-items-center rounded-lg border bg-popover text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <span className="hidden text-sm font-semibold sm:inline">Print Designer</span>
          <span className="hidden h-4 w-px bg-border sm:block" />
          <Select
            aria-label="Document"
            title="Choose a document to design"
            className="h-8 w-64 text-xs font-medium"
            value={docKey}
            onChange={(event) => void changeDocument(event.target.value as DesignDocumentKey)}
          >
            {DOCUMENTS.map((d) => (
              <option key={d.key} value={d.key}>
                {activeKeys.includes(d.key) ? '● ' : ''}
                {d.label}
              </option>
            ))}
          </Select>
          <span
            title={ready?.updatedBy ? `Last saved by ${ready.updatedBy}` : undefined}
            className={cn(
              'hidden rounded-full px-2 py-0.5 text-[10px] font-semibold sm:inline-flex',
              status === 'live' ? 'bg-success/15 text-success' : status === 'draft' ? 'bg-warning/20 text-accent-foreground' : 'bg-secondary text-muted-foreground',
            )}
          >
            {status === 'live' ? '● Live' : status === 'draft' ? '● Draft' : 'Standard'}
          </span>
          {dirty && <span className="hidden rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-accent-foreground sm:inline-flex">Unsaved</span>}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="inline-flex rounded-lg border bg-secondary p-0.5">
            {(['design', 'preview'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium capitalize',
                  mode === value ? 'bg-popover text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {value === 'design' ? <PenTool className="size-3.5" /> : <Eye className="size-3.5" />}
                {value}
              </button>
            ))}
          </div>

          {mode === 'design' && (
            <div className="flex items-center gap-0.5 border-l pl-1.5">
              <button type="button" className={iconBtn} disabled={!ready?.history.past.length} onClick={undo} title="Undo (Ctrl+Z)"><Undo2 className="size-4" /></button>
              <button type="button" className={iconBtn} disabled={!ready?.history.future.length} onClick={redo} title="Redo (Ctrl+Y)"><Redo2 className="size-4" /></button>
            </div>
          )}

          <div className="flex items-center gap-1 border-l pl-1.5">
            <button type="button" className={iconBtn} title="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 10) / 10))}><ZoomOut className="size-4" /></button>
            <Select aria-label="Zoom" className="h-8 w-[5.5rem] text-xs" value={String(zoom)} onChange={(event) => setZoom(Number(event.target.value))}>
              {[...new Set([0.3, 0.5, 0.75, 1, 1.25, 1.5, 2, zoom])].sort((a, b) => a - b).map((value) => (
                <option key={value} value={String(value)}>{Math.round(value * 100)}%</option>
              ))}
            </Select>
            <button type="button" className={iconBtn} title="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 10) / 10))}><ZoomIn className="size-4" /></button>
            <button type="button" className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/15" title="Fit the paper to the visible canvas" onClick={fitToScreen}>Fit</button>
          </div>

          {mode === 'design' && (
            <div className="hidden items-center gap-1 border-l pl-1.5 lg:flex">
              <Select aria-label="Snap to grid" className="h-8 w-24 text-xs" value={String(snap)} onChange={(event) => setSnap(Number(event.target.value))}>
                <option value="0">No snap</option>
                <option value="0.5">0.5 mm</option>
                <option value="1">1 mm</option>
                <option value="5">5 mm</option>
              </Select>
              <button type="button" className={cn(toggleBtn(showRulers), 'inline-flex items-center gap-1 text-xs')} onClick={() => setShowRulers(!showRulers)} title={showRulers ? 'Hide rulers' : 'Show millimetre rulers'}>
                <Ruler className="size-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {mode === 'design' && (
            <div className="flex items-center gap-1 border-r pr-1.5">
              <button type="button" className={toggleBtn(showLeftTools)} onClick={() => setShowLeftTools(!showLeftTools)} title={showLeftTools ? 'Hide tools' : 'Show tools'}>
                {showLeftTools ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
              </button>
              <button type="button" className={toggleBtn(showRightInspector)} onClick={() => setShowRightInspector(!showRightInspector)} title={showRightInspector ? 'Hide inspector' : 'Show inspector'}>
                {showRightInspector ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
              </button>
              <button type="button" className={toggleBtn(isFullscreen)} onClick={toggleFullscreen} title={isFullscreen ? 'Exit full screen' : 'Full screen'}>
                {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
            </div>
          )}
          <Button size="sm" variant="secondary" disabled={!ready} onClick={() => { setMode('preview'); setPrintRequested(true) }} title="Print a test page with sample data">
            <Printer className="size-3.5" /> <span className="hidden xl:inline">Test print</span>
          </Button>
          {ready?.stored && (
            <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void removeDesign()} title="Delete this design">
              <X className="size-3.5" /> <span className="hidden md:inline">Delete</span>
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={!ready || busy} onClick={() => void save(false)} title="Save without changing what prints">
            <Save className="size-3.5" /> <span className="hidden sm:inline">{ready?.active ? 'Draft' : 'Save draft'}</span>
          </Button>
          <Button size="sm" disabled={!ready || busy || (ready.active && !dirty)} loading={busy} onClick={() => void save(true)}>
            {!busy && <Printer className="size-3.5" />} {ready?.active ? 'Save changes' : 'Save & use'}
          </Button>
        </div>
      </header>

      {/* ---------------------------------------------------------------- body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {mode === 'design' && showLeftTools && (
          <aside className="flex w-48 shrink-0 flex-col justify-between overflow-y-auto border-r p-3">
            <div className="space-y-3">
              <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Add element</p>
              <button type="button" onClick={() => add('text')} className={toolBtn}><Type className="size-4 text-primary" /> Text block</button>
              <Select
                aria-label="Add a data field"
                title="Add a data field"
                className="h-8 text-xs"
                value=""
                onChange={(event) => {
                  const field = info.fields.find((item) => item.key === event.target.value)
                  if (field) add('text', { text: `${field.label.replace(/ \(.*\)$/, '')}: {{${field.key}}}` })
                }}
              >
                <option value="">+ Data field…</option>
                {info.fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
              </Select>
              <button type="button" onClick={() => add('logo')} className={toolBtn}><ImageIcon className="size-4 text-primary" /> Company logo</button>
              <button type="button" onClick={() => add('line')} className={toolBtn}><Minus className="size-4 text-primary" /> Divider line</button>
              <button type="button" onClick={() => add('box')} className={toolBtn}><Square className="size-4 text-primary" /> Rectangle box</button>

              {info.tables.length > 0 && (
                <div className="space-y-1.5 border-t pt-2">
                  <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Tables</p>
                  {info.tables.map((table) => (
                    <button key={table.source} type="button" onClick={() => add('table', { source: table.source })} className={toolBtn}>
                      <Table2 className="size-4 shrink-0 text-primary" /> <span className="truncate">{table.label}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2 border-t pt-2">
                <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Form scan</p>
                <label className={cn(toolBtn, 'cursor-pointer border-dashed')} title="Trace a scan of your pre-printed form">
                  <ImagePlus className="size-4 text-muted-foreground" /> <span className="truncate">{background ? 'Change scan' : 'Trace scan'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(event) => { chooseBackground(event.target.files?.[0]); event.target.value = '' }} />
                </label>
                {background && (
                  <div className="flex items-center gap-1.5">
                    <input type="range" min={0.1} max={1} step={0.1} value={background.opacity} aria-label="Scan strength" onChange={(event) => setBackground({ ...background, opacity: Number(event.target.value) })} className="w-full accent-[var(--primary)]" />
                    <button type="button" className={iconBtn} onClick={() => setBackground(null)} title="Remove scan"><X className="size-3.5" /></button>
                  </div>
                )}
              </div>
            </div>

            <button type="button" className={cn(toolBtn, 'mt-3 justify-center text-muted-foreground hover:border-destructive/40 hover:text-destructive')} disabled={!ready} onClick={() => void startOver()}>
              <RotateCcw className="size-3.5" /> Reset layout
            </button>
          </aside>
        )}

        <main ref={viewportRef} className="relative flex flex-1 items-start justify-center overflow-auto bg-neutral-200/70 p-4 sm:p-6 dark:bg-neutral-900/60">
          {!template ? (
            <div className="flex items-center gap-2 rounded-2xl bg-popover p-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading design…
            </div>
          ) : mode === 'design' ? (
            <DesignerCanvas
              template={template}
              data={data}
              selectedId={selectedId}
              zoom={zoom}
              snap={snap}
              background={background}
              showRulers={showRulers}
              onSelect={(id) => {
                setSelectedId(id)
                if (id && !showRightInspector) setShowRightInspector(true)
              }}
              onChange={preview}
              onCommit={commit}
            />
          ) : (
            // data-print-root: Test print prints only this document (lib/print.ts).
            <div data-print-root className="mx-auto w-fit [zoom:var(--preview-zoom)] print:[zoom:1]" style={{ '--preview-zoom': zoom } as CSSProperties}>
              <DesignedDocument template={template} data={data} />
            </div>
          )}
        </main>

        {mode === 'design' && template && showRightInspector && (
          <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l">
            <PropertiesPanel
              template={template}
              info={info}
              selected={selected}
              onChange={apply}
              onPaperChange={changePaper}
              onDuplicate={duplicate}
              onDelete={remove}
              onReorder={(direction) => selected && apply(reorderElement(template, selected.id, direction))}
              sampleRows={sampleRows}
              onSampleRowsChange={setSampleRows}
              resized={resized}
              offPage={offPage}
              onScaleToPaper={() => resized && apply(scaleToPaper(template, resized))}
              onRebuildForPaper={rebuildForPaper}
            />
          </aside>
        )}
      </div>
    </div>
  )
}
