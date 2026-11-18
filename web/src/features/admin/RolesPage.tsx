import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { Card, PageHeader, Spinner, Table, Td, Th } from '@/components/ui'
import { api } from '@/lib/api'
import { roleLabel } from './UsersPage'

type RoleRow = { name: string; users_count: number; permissions: string[] }

/** Read-only matrix: which role can do what. */
export function RolesPage() {
  const roles = useQuery({
    queryKey: ['admin-roles'],
    queryFn: async () => (await api.get<{ data: RoleRow[]; meta: { all_permissions: string[] } }>('/api/v1/admin/roles')).data,
  })

  if (roles.isPending) return <Spinner />
  const list = roles.data?.data ?? []
  const all = roles.data?.meta.all_permissions ?? []

  return (
    <div>
      <PageHeader title="Roles & permissions" description="Roles are fixed in the system. Assign a role to each user on the Users page." />
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Permission</Th>
              {list.map((r) => (
                <Th key={r.name} className="text-center">
                  {roleLabel(r.name)}
                  <div className="font-normal">{r.users_count} user(s)</div>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.map((p) => (
              <tr key={p}>
                <Td className="font-mono text-xs">{p}</Td>
                {list.map((r) => (
                  <Td key={r.name} className="text-center">
                    {r.permissions.includes(p) && <Check className="mx-auto size-4 text-success" />}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
