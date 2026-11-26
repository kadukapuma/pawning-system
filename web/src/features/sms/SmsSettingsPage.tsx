import { useState } from 'react'
import { toast } from 'sonner'
import { Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui'
import { useApiMutation, useApiQuery } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { LANGUAGES, MessageEditor, type Language, type Mode, type Texts } from './shared'

type Rule = {
  type: string
  label: string
  is_reminder: boolean
  modes: Mode[]
  offset_range: [number, number] | null
  placeholders: string[]
  mode: Mode
  offsets: number[]
  send_time: string | null
  templates: Texts
}

type Settings = {
  enabled: boolean
  default_language: Language
  configured: boolean
  sender_id: string | null
  rules: Rule[]
}

export function SmsSettingsPage() {
  const settings = useApiQuery<Settings>(['sms', 'settings'], '/api/v1/sms/settings')
  const [selected, setSelected] = useState('birthday')

  if (settings.isPending) return <Spinner />
  if (!settings.data) return <p className="text-destructive">Could not load the SMS settings.</p>
  const s = settings.data
  const rule = s.rules.find((r) => r.type === selected) ?? s.rules[0]

  return (
    <div className="space-y-5">
      <PageHeader title="SMS settings" description="Choose which messages are sent, when, and what they say." />

      <div className="grid gap-5 lg:grid-cols-2">
        <General settings={s} />
        <Gateway settings={s} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
        <Card className="h-fit p-2">
          {s.rules.map((r) => (
            <button
              key={r.type}
              type="button"
              onClick={() => setSelected(r.type)}
              aria-current={r.type === rule.type}
              className={cn('flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary', r.type === rule.type && 'bg-secondary font-medium')}
            >
              {r.label}
              <Badge tone={r.mode === 'off' ? 'neutral' : r.mode === 'auto' ? 'success' : 'primary'}>{r.mode}</Badge>
            </button>
          ))}
        </Card>
        <RuleEditor key={rule.type} rule={rule} defaultLanguage={s.default_language} />
      </div>
    </div>
  )
}

function General({ settings }: { settings: Settings }) {
  const [enabled, setEnabled] = useState(settings.enabled)
  const [language, setLanguage] = useState<Language>(settings.default_language)
  const save = useApiMutation<{ enabled: boolean; default_language: Language }>({
    method: 'put', url: '/api/v1/sms/settings', invalidate: [['sms']], success: 'SMS settings saved',
  })

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-semibold">General</h2>
      <div>
        <Checkbox label="Send SMS (master switch)" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <p className="text-xs text-muted-foreground">While off, only the test message below is sent.</p>
      </div>
      <Field label="Default language" hint="Used for customers with no language chosen, or when their language has no text.">
        <Select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="max-w-52">
          {LANGUAGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
      </Field>
      <div className="flex justify-end">
        <Button loading={save.isPending} onClick={() => save.mutate({ enabled, default_language: language })}>Save</Button>
      </div>
    </Card>
  )
}

function Gateway({ settings }: { settings: Settings }) {
  const [checkBalance, setCheckBalance] = useState(false)
  const account = useApiQuery<{ active: boolean; balance: string | null; error: string | null }>(['sms', 'account'], '/api/v1/sms/account', checkBalance)
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('Test message from Sampath Pawning.')
  const test = useApiMutation<{ phone: string; message: string }, { sent: boolean; error: string | null }>({
    url: '/api/v1/sms/test',
    invalidate: [['sms', 'messages']],
    onSuccess: (r) => (r.sent ? toast.success('Test SMS accepted by Notify.lk') : toast.error(r.error ?? 'The test SMS was not sent')),
  })

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Notify.lk connection</h2>
        <Badge tone={settings.configured ? 'success' : 'danger'}>{settings.configured ? 'configured' : 'not set up'}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {settings.configured
          ? <>Sender ID <span className="font-mono">{settings.sender_id}</span>. Account keys are kept in the server .env file.</>
          : 'Fill the NOTIFYLK_ values in the server .env file.'}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Button
          size="sm" variant="secondary" disabled={!settings.configured} loading={account.isFetching}
          onClick={() => (checkBalance ? account.refetch() : setCheckBalance(true))}
        >
          Check balance
        </Button>
        {account.data && (account.data.error
          ? <span className="text-destructive">{account.data.error}</span>
          : <span>Balance {account.data.balance ?? 'unknown'} · account {account.data.active ? 'active' : 'inactive'}</span>)}
      </div>
      <div className="grid gap-3 border-t pt-4">
        <Field label="Test mobile number" error={test.fieldErrors.phone}>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="077 123 4567" className="max-w-52" />
        </Field>
        <Field label="Test message" error={test.fieldErrors.message}>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-14" maxLength={612} />
        </Field>
        <div className="flex justify-end">
          <Button
            variant="secondary" loading={test.isPending} disabled={!settings.configured || !phone.trim() || !message.trim()}
            onClick={() => window.confirm(`Send a real SMS to ${phone}? It is charged to your Notify.lk account.`) && test.mutate({ phone, message })}
          >
            Send test SMS
          </Button>
        </div>
      </div>
    </Card>
  )
}

type RuleBody = { mode: Mode; offsets: number[] | null; send_time: string | null; templates: Texts }

function RuleEditor({ rule, defaultLanguage }: { rule: Rule; defaultLanguage: Language }) {
  const [mode, setMode] = useState<Mode>(rule.mode)
  const [days, setDays] = useState(rule.offsets.join(', '))
  const [time, setTime] = useState(rule.send_time ?? '09:00')
  const [texts, setTexts] = useState<Texts>(rule.templates)
  const [language, setLanguage] = useState<Language>(defaultLanguage)
  const save = useApiMutation<RuleBody>({
    method: 'put', url: `/api/v1/sms/rules/${rule.type}`, invalidate: [['sms']], success: `${rule.label} saved`,
  })

  const errors = save.fieldErrors
  const daysError = errors.offsets ?? Object.entries(errors).find(([k]) => k.startsWith('offsets.'))?.[1]
  const when = rule.type === 'arrears_reminder' ? 'after the maturity date' : rule.type === 'promise_reminder' ? 'before the promised date' : 'before the maturity date'
  const modeLabel: Record<Mode, string> = {
    off: 'Off',
    auto: rule.is_reminder ? 'Automatic (sent daily by the server)' : 'Automatic (after each transaction)',
    manual: 'Manual (staff press Send)',
  }

  const submit = () => save.mutate({
    mode,
    offsets: rule.offset_range ? days.split(/[,\s]+/).filter(Boolean).map(Number) : null,
    send_time: rule.is_reminder ? time : null,
    templates: texts,
  })

  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">{rule.label}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Sending" error={errors.mode}>
          <Select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            {rule.modes.map((m) => <option key={m} value={m}>{modeLabel[m]}</option>)}
          </Select>
        </Field>
        {rule.offset_range && (
          <Field label={`Days ${when}`} error={daysError} hint={`Up to 6 values from ${rule.offset_range[0]} to ${rule.offset_range[1]}, e.g. 7, 1`}>
            <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" aria-invalid={!!daysError} />
          </Field>
        )}
        {rule.is_reminder && (
          <Field label="Send time" error={errors.send_time} hint="For automatic sending. If switched on after this time, today's messages go at once.">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        )}
      </div>
      {rule.type === 'forfeit_warning' && (
        <p className="text-sm text-muted-foreground">Sent once to each ticket on the forfeit reminder list (after letter 3), unless the customer's promise date has not passed.</p>
      )}

      <div role="tablist" aria-label="Message language" className="flex gap-1 border-b">
        {LANGUAGES.map(([k, label]) => (
          <button
            key={k} type="button" role="tab" aria-selected={language === k} onClick={() => setLanguage(k)}
            className={cn('-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm', language === k && 'border-primary font-medium', errors[`templates.${k}`] && 'text-destructive')}
          >
            {label}{!texts[k].trim() && <span className="text-muted-foreground"> (empty)</span>}
          </button>
        ))}
      </div>
      <MessageEditor
        key={language}
        type={rule.type}
        label={`Message (${LANGUAGES.find(([k]) => k === language)?.[1]})`}
        value={texts[language]}
        onChange={(v) => setTexts((t) => ({ ...t, [language]: v }))}
        placeholders={rule.placeholders}
        error={errors[`templates.${language}`]}
        hint="Leave empty to use the default language."
      />

      <div className="flex justify-end">
        <Button loading={save.isPending} onClick={submit}>Save {rule.label.toLowerCase()}</Button>
      </div>
    </Card>
  )
}
