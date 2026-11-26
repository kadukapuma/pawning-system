import { useEffect, useState } from 'react'
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui'
import { useApiMutation, useLookups } from '@/lib/hooks'
import type { Customer } from '@/lib/types'
import { decodeNic, nicError, normalizeNic } from './sriLankanNic'
import { mobileError, otherPhoneError, stripPhoneFormatting } from './sriLankanPhone'

type FormState = {
  title: string
  first_name: string
  middle_name: string
  last_name: string
  gender: string
  nic: string
  date_of_birth: string
  address_line1: string
  address_line2: string
  city: string
  phone1: string
  phone2: string
  email: string
  driving_license: string
  passport: string
  other_identification: string
  notes: string
}

const empty: FormState = {
  title: 'Mr', first_name: '', middle_name: '', last_name: '', gender: '', nic: '', date_of_birth: '',
  address_line1: '', address_line2: '', city: '', phone1: '', phone2: '', email: '',
  driving_license: '', passport: '', other_identification: '', notes: '',
}

function fromCustomer(c: Customer): FormState {
  const s = (v: string | null | undefined) => v ?? ''
  return {
    title: s(c.title), first_name: c.first_name, middle_name: s(c.middle_name), last_name: s(c.last_name),
    gender: s(c.gender), nic: c.nic, date_of_birth: s(c.date_of_birth), address_line1: c.address_line1,
    address_line2: s(c.address_line2), city: s(c.city), phone1: c.phone1, phone2: s(c.phone2), email: s(c.email),
    driving_license: s(c.driving_license), passport: s(c.passport), other_identification: s(c.other_identification),
    notes: s(c.notes),
  }
}

/** Create or edit a customer. Empty strings are sent as null. */
export function CustomerFormDialog({
  open,
  onClose,
  customer,
  initialNic,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  customer?: Customer
  initialNic?: string
  onSaved?: (c: Customer) => void
}) {
  const { data: lookups } = useLookups()
  const [form, setForm] = useState<FormState>(empty)
  const [nicBlurred, setNicBlurred] = useState(false)
  const [phoneTouched, setPhoneTouched] = useState({ phone1: false, phone2: false })

  const save = useApiMutation<Record<string, string | null>, Customer>({
    method: customer ? 'put' : 'post',
    url: customer ? `/api/v1/customers/${customer.id}` : '/api/v1/customers',
    invalidate: [['customers']],
    success: customer ? 'Customer updated' : 'Customer created',
    onSuccess: (c) => {
      onSaved?.(c)
      onClose()
    },
  })

  useEffect(() => {
    if (open) {
      const nic = normalizeNic(initialNic ?? '')
      setForm(customer ? fromCustomer(customer) : { ...empty, nic, ...decodeNic(nic) })
      setNicBlurred(false)
      setPhoneTouched({ phone1: false, phone2: false })
      save.clearErrors()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer, initialNic])

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const err = save.fieldErrors
  const nic = normalizeNic(form.nic)
  const unchangedNic = !!customer && nic === customer.nic
  const invalidNic = !nic || (!unchangedNic && !decodeNic(nic))
  const nicFieldError = (nicBlurred && invalidNic ? (nic ? nicError : 'Enter the customer’s NIC.') : undefined) ?? err.nic
  const phone1Error = customer?.phone1 === form.phone1 ? undefined : mobileError(form.phone1)
  const phone2Error = customer?.phone2 === form.phone2 ? undefined : otherPhoneError(form.phone2)
  const mobileFieldError = (phoneTouched.phone1 ? phone1Error : undefined) ?? err.phone1
  const otherPhoneFieldError = (phoneTouched.phone2 ? phone2Error : undefined) ?? err.phone2

  const touchPhone = (field: 'phone1' | 'phone2') => setPhoneTouched((current) => (
    current[field] ? current : { ...current, [field]: true }
  ))

  const changePhone = (field: 'phone1' | 'phone2') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = field === 'phone1' ? stripPhoneFormatting(e.target.value) : e.target.value
    if (field === 'phone1' && value.length > (value.startsWith('+') ? 12 : 10)) return

    if (err[field]) save.clearErrors()
    if (field === 'phone1') touchPhone(field)
    setForm((current) => ({ ...current, [field]: value }))
  }

  const changeNic = (value: string) => {
    const normalized = normalizeNic(value)
    if (normalized.length > 12) return

    if (err.nic) save.clearErrors()
    setForm((current) => {
      if (normalized === normalizeNic(current.nic)) return { ...current, nic: normalized }

      const details = customer && normalized === customer.nic ? fromCustomer(customer) : decodeNic(normalized)
      return { ...current, nic: normalized, gender: details?.gender ?? '', date_of_birth: details?.date_of_birth ?? '' }
    })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setNicBlurred(true)
    setPhoneTouched({ phone1: true, phone2: true })
    if (invalidNic || phone1Error || phone2Error) return

    const body = Object.fromEntries(Object.entries({ ...form, nic }).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]))
    save.mutate(body)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={customer ? `Edit ${customer.code}` : 'New customer'}
      description="NIC accepts 9 digits plus V or X, or 12 digits. Phone numbers accept local or +94 format."
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="customer-form" loading={save.isPending}>
            {customer ? 'Save changes' : 'Create customer'}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-6">
        <Field label="Title" className="sm:col-span-1" error={err.title}>
          <Select value={form.title} onChange={set('title')}>
            <option value="">—</option>
            {lookups?.customer_titles.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="First name" required className="sm:col-span-2" error={err.first_name}>
          <Input value={form.first_name} onChange={set('first_name')} aria-invalid={!!err.first_name} autoFocus />
        </Field>
        <Field label="Middle name" className="sm:col-span-1" error={err.middle_name}>
          <Input value={form.middle_name} onChange={set('middle_name')} />
        </Field>
        <Field label="Last name" className="sm:col-span-2" error={err.last_name}>
          <Input value={form.last_name} onChange={set('last_name')} />
        </Field>

        <Field label="NIC" required className="sm:col-span-2" error={nicFieldError}>
          <Input value={form.nic} onChange={(e) => changeNic(e.target.value)} onBlur={() => setNicBlurred(true)} aria-invalid={!!nicFieldError} className="uppercase" />
        </Field>
        <Field label="Gender" className="sm:col-span-2" error={err.gender}>
          <Select value={form.gender} onChange={set('gender')}>
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Date of birth" className="sm:col-span-2" error={err.date_of_birth}>
          <Input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
        </Field>

        <Field label="Address line 1" required className="sm:col-span-3" error={err.address_line1}>
          <Input value={form.address_line1} onChange={set('address_line1')} aria-invalid={!!err.address_line1} />
        </Field>
        <Field label="Address line 2" className="sm:col-span-2" error={err.address_line2}>
          <Input value={form.address_line2} onChange={set('address_line2')} />
        </Field>
        <Field label="City" className="sm:col-span-1" error={err.city}>
          <Input value={form.city} onChange={set('city')} />
        </Field>

        <Field label="Mobile" required className="sm:col-span-2" error={mobileFieldError}>
          <Input type="tel" value={form.phone1} onChange={changePhone('phone1')} onBlur={() => touchPhone('phone1')} aria-invalid={!!mobileFieldError} />
        </Field>
        <Field label="Other phone" className="sm:col-span-2" error={otherPhoneFieldError}>
          <Input type="tel" value={form.phone2} onChange={changePhone('phone2')} onBlur={() => touchPhone('phone2')} aria-invalid={!!otherPhoneFieldError} />
        </Field>
        <Field label="Email" className="sm:col-span-2" error={err.email}>
          <Input type="email" value={form.email} onChange={set('email')} />
        </Field>

        <Field label="Driving licence" className="sm:col-span-2" error={err.driving_license}>
          <Input value={form.driving_license} onChange={set('driving_license')} />
        </Field>
        <Field label="Passport" className="sm:col-span-2" error={err.passport}>
          <Input value={form.passport} onChange={set('passport')} />
        </Field>
        <Field label="Other ID" className="sm:col-span-2" error={err.other_identification}>
          <Input value={form.other_identification} onChange={set('other_identification')} />
        </Field>

        <Field label="Notes" className="sm:col-span-6" error={err.notes}>
          <Textarea value={form.notes} onChange={set('notes')} />
        </Field>
      </form>
    </Dialog>
  )
}
