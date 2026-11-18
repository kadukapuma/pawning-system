import { useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui'
import { api } from '@/lib/api'

export type AccountOption = {
  id: number
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  is_cash: boolean
  is_bank: boolean
  is_system: boolean
  system_key: string | null
}

export function useAccountOptions() {
  return useQuery({
    queryKey: ['account-options'],
    queryFn: async () => (await api.get<{ data: AccountOption[] }>('/api/v1/accounting/account-options')).data.data,
    staleTime: 5 * 60_000,
  })
}

export function AccountSelect({
  value, onChange, filter, placeholder = 'Select account…', invalid,
}: {
  value: string
  onChange: (v: string) => void
  filter?: (a: AccountOption) => boolean
  placeholder?: string
  invalid?: boolean
}) {
  const { data } = useAccountOptions()
  const list = (data ?? []).filter(filter ?? (() => true))
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid}>
      <option value="">{placeholder}</option>
      {list.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
    </Select>
  )
}

export const isCashOrBank = (a: AccountOption) => a.is_cash || a.is_bank

export const today = () => new Date().toISOString().slice(0, 10)
