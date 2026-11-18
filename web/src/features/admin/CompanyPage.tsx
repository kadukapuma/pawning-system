import { useEffect, useState } from 'react'
import { Button, Card, Field, Input, PageHeader, Spinner, Textarea } from '@/components/ui'
import { useApiMutation, useApiQuery } from '@/lib/hooks'

type Company = {
  name: string
  registration_no: string | null
  address: string | null
  phone: string | null
  phone2: string | null
  email: string | null
  receipt_footer: string | null
}

const FIELDS: [keyof Company, string][] = [
  ['name', 'Company name'],
  ['registration_no', 'Registration no.'],
  ['address', 'Head office address'],
  ['phone', 'Phone'],
  ['phone2', 'Other phone'],
  ['email', 'Email'],
]

export function CompanyPage() {
  const company = useApiQuery<Company>(['company'], '/api/v1/company')
  const [f, setF] = useState<Record<string, string>>({})
  const save = useApiMutation<Record<string, string | null>>({ method: 'put', url: '/api/v1/admin/company', invalidate: [['company']], success: 'Company details saved' })

  useEffect(() => {
    if (company.data) setF(Object.fromEntries(Object.entries(company.data).map(([k, v]) => [k, v == null ? '' : String(v)])))
  }, [company.data])

  if (company.isPending) return <Spinner />

  return (
    <div>
      <PageHeader title="Company" description="Printed on receipts, tickets and letters." />
      <Card className="max-w-3xl p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map(([k, label]) => (
            <Field key={k} label={label} required={k === 'name'} error={save.fieldErrors[k]} className={k === 'address' ? 'sm:col-span-2' : ''}>
              <Input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </Field>
          ))}
          <Field label="Receipt footer" className="sm:col-span-2" error={save.fieldErrors.receipt_footer} hint="Short note printed at the bottom of receipts.">
            <Textarea value={f.receipt_footer ?? ''} onChange={(e) => setF({ ...f, receipt_footer: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            loading={save.isPending}
            onClick={() => save.mutate(Object.fromEntries(FIELDS.map(([k]) => [k, f[k] || null]).concat([['receipt_footer', f.receipt_footer || null]])))}
          >
            Save
          </Button>
        </div>
      </Card>
    </div>
  )
}
