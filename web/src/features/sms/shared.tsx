import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Field, Textarea } from '@/components/ui'
import { api } from '@/lib/api'
import { useApiQuery, useDebounced } from '@/lib/hooks'

export type Language = 'en' | 'si' | 'ta'
export type Mode = 'off' | 'auto' | 'manual'
export type Texts = Record<Language, string>

export const LANGUAGES: [Language, string][] = [['en', 'English'], ['si', 'Sinhala'], ['ta', 'Tamil']]
export const emptyTexts: Texts = { en: '', si: '', ta: '' }

export type SmsStatus = {
  enabled: boolean
  types: { type: string; label: string; is_reminder: boolean; mode: Mode; offsets: number[] }[]
}

export const useSmsStatus = () => useApiQuery<SmsStatus>(['sms', 'status'], '/api/v1/sms/status')

export function SmsStatusBadge({ status }: { status: string }) {
  const tone = status === 'sent' ? 'success' : status === 'failed' ? 'danger' : status === 'queued' ? 'warning' : status === 'sending' ? 'primary' : 'neutral'
  return <Badge tone={tone}>{status}</Badge>
}

export function OffNotice({ children }: { children: React.ReactNode }) {
  return <p role="status" className="mb-4 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">{children}</p>
}

/** One message text with placeholder buttons and a live preview with SMS part count. */
export function MessageEditor({
  type,
  label,
  value,
  onChange,
  placeholders,
  error,
  hint,
}: {
  type: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholders: string[]
  error?: string
  hint?: string
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<number | null>(null)
  const body = useDebounced(value, 350)
  const preview = useQuery({
    queryKey: ['sms', 'preview', type, body],
    queryFn: async () =>
      (await api.post<{ data: { text: string; length: number; segments: number; unicode: boolean; unknown: string[] } }>('/api/v1/sms/preview', { type, body })).data.data,
    enabled: body.trim() !== '',
    placeholderData: (previous) => previous,
  })

  // Put the cursor back after a placeholder button inserts text.
  useEffect(() => {
    if (caret.current === null) return
    box.current?.focus()
    box.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [value])

  const insert = (name: string) => {
    const el = box.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const token = `{${name}}`
    caret.current = start + token.length
    onChange(value.slice(0, start) + token + value.slice(end))
  }

  const p = value.trim() ? preview.data : undefined

  return (
    <div className="space-y-2">
      <Field label={label} error={error} hint={hint}>
        <Textarea ref={box} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} className="min-h-24" maxLength={1000} />
      </Field>
      <div className="flex flex-wrap gap-1">
        {placeholders.map((name) => (
          <Button key={name} type="button" size="sm" variant="secondary" className="h-6 px-2 font-mono" onClick={() => insert(name)}>
            {`{${name}}`}
          </Button>
        ))}
      </div>
      {p && (
        <div className="rounded-md bg-secondary/50 p-3 text-sm">
          <p className="text-xs font-semibold text-muted-foreground">Preview with example details</p>
          <p className="whitespace-pre-wrap">{p.text}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {p.length} characters · {p.segments} SMS part{p.segments === 1 ? '' : 's'}{p.unicode && ' (Sinhala, Tamil or special characters: 70 per part)'}
          </p>
          {p.unknown.length > 0 && <p className="text-xs text-destructive">Not available for this message: {p.unknown.map((u) => `{${u}}`).join(', ')}</p>}
        </div>
      )}
    </div>
  )
}
