import { useLookups } from '@/lib/hooks'
import type { ArticleCategory, ArticleCondition, ArticleType, BranchRef } from '@/lib/types'
import { SimpleMasterPage } from './SimpleMasterPage'

const metalOptions = [
  { value: 'gold', label: 'Gold' },
  { value: 'silver', label: 'Silver' },
  { value: 'other', label: 'Other' },
]

export function CategoriesPage() {
  return (
    <SimpleMasterPage<ArticleCategory>
      title="Item categories"
      description="Earring, chain, bangle… A SILVER category puts a pawn on the Silver scheme."
      endpoint="/api/v1/article-categories"
      queryKey="article-categories"
      permission="masters.manage"
      searchText={(r) => r.name}
      columns={[
        { label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
        { label: 'Metal', render: (r) => <span className="capitalize">{r.metal}</span> },
        { label: 'Item types', render: (r) => r.types_count ?? 0, className: 'text-right' },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'metal', label: 'Metal', type: 'select', options: metalOptions },
        { name: 'is_active', label: 'Active', type: 'checkbox' },
      ]}
    />
  )
}

export function ArticleTypesPage() {
  const { data: lookups } = useLookups()
  const categoryOptions = (lookups?.article_categories ?? []).map((c) => ({ value: String(c.id), label: c.name }))

  return (
    <SimpleMasterPage<ArticleType>
      title="Item setup"
      description="Specific items within a category. Codes are assigned automatically."
      endpoint="/api/v1/article-types"
      queryKey="article-types"
      permission="masters.manage"
      searchText={(r) => `${r.code} ${r.name} ${r.sub_category ?? ''} ${r.category?.name ?? ''}`}
      columns={[
        { label: 'Code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
        { label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
        { label: 'Category', render: (r) => r.category?.name },
        { label: 'Sub category', render: (r) => r.sub_category || <span className="text-muted-foreground">—</span> },
      ]}
      fields={[
        { name: 'category_id', label: 'Category', type: 'select', options: categoryOptions, required: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'sub_category', label: 'Sub category', hint: 'Optional, e.g. Ladies, Gents, Kids.' },
        { name: 'is_active', label: 'Active', type: 'checkbox' },
      ]}
    />
  )
}

export function ConditionsPage() {
  return (
    <SimpleMasterPage<ArticleCondition>
      title="Item conditions"
      description="Condition recorded for each item when it is pawned."
      endpoint="/api/v1/article-conditions"
      queryKey="article-conditions"
      permission="masters.manage"
      searchText={(r) => r.name}
      columns={[{ label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> }]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'is_active', label: 'Active', type: 'checkbox' },
      ]}
    />
  )
}

type AdminBranch = BranchRef & { address: string | null; phone: string | null; phone2: string | null; opened_on: string | null; is_active: boolean; users_count: number }

export function BranchesPage() {
  return (
    <SimpleMasterPage<AdminBranch>
      title="Branches"
      description="The 3-digit code is permanent — it is printed on documents and used in customer codes. New branches get their own document numbering."
      endpoint="/api/v1/admin/branches"
      queryKey="admin-branches"
      permission="branches.manage"
      searchText={(r) => `${r.code} ${r.name}`}
      columns={[
        { label: 'Code', render: (r) => <span className="font-mono">{r.code}</span> },
        { label: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
        { label: 'Address', render: (r) => r.address },
        { label: 'Phone', render: (r) => r.phone },
        { label: 'Users', render: (r) => r.users_count, className: 'text-right' },
      ]}
      fields={[
        { name: 'code', label: 'Code (3 digits)', required: true, createOnly: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'address', label: 'Address' },
        { name: 'phone', label: 'Phone' },
        { name: 'phone2', label: 'Other phone' },
        { name: 'is_active', label: 'Active', type: 'checkbox' },
      ]}
    />
  )
}
