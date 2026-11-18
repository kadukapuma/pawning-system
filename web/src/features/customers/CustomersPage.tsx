import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { api } from '@/lib/api'
import { useDebounced } from '@/lib/hooks'
import type { Customer, CustomerStatus, Paginated } from '@/lib/types'
import { CustomerFormDialog } from './CustomerFormDialog'

export const statusTone = (s: CustomerStatus) => (s === 'active' ? 'success' : s === 'blacklisted' ? 'danger' : 'neutral')

export function CustomersPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const search = useDebounced(q)

  const list = useQuery({
    queryKey: ['customers', { search, status, page }],
    queryFn: async () =>
      (await api.get<Paginated<Customer>>('/api/v1/customers', { params: { q: search || undefined, status: status || undefined, page } })).data,
    placeholderData: keepPreviousData,
  })

  return (
    <div>
      <PageHeader
        title="Customers"
        description="One record per person across all branches. Search by NIC, name, code or phone."
        actions={
          can('customers.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New customer
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <div className="relative min-w-60 flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="NIC, name, code or phone…"
              className="pl-9"
              autoFocus
            />
          </div>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            className="w-40"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="blacklisted">Blacklisted</option>
          </Select>
        </div>

        {list.isPending ? (
          <div className="grid place-items-center py-14"><Spinner /></div>
        ) : list.data?.data.length === 0 ? (
          <EmptyState title="No customers found">{q ? 'Try another search.' : 'Create the first customer.'}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th><Th>Name</Th><Th>NIC</Th><Th>Mobile</Th><Th>City</Th><Th>Branch</Th><Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {list.data?.data.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer hover:bg-secondary/50"
                  onClick={() => navigate(`/customers/${c.id}`)}
                >
                  <Td className="font-mono text-xs">{c.code}</Td>
                  <Td className="font-medium">{[c.title, c.full_name].filter(Boolean).join(' ')}</Td>
                  <Td className="font-mono text-xs">{c.nic}</Td>
                  <Td>{c.phone1}</Td>
                  <Td>{c.city}</Td>
                  <Td>{c.branch?.code}</Td>
                  <Td><Badge tone={statusTone(c.status)}>{c.status}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Card>

      <CustomerFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        initialNic={/^[0-9]{9,12}[vVxX]?$/.test(q.trim()) ? q.trim().toUpperCase() : undefined}
        onSaved={(c) => navigate(`/customers/${c.id}`)}
      />
    </div>
  )
}
