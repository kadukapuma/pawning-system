import {
  BarChart3,
  BookOpen,
  Boxes,
  FileWarning,
  Gem,
  LayoutDashboard,
  Landmark,
  Settings,
  ShoppingCart,
  Users,
  type LucideIcon,
} from 'lucide-react'

/** `permission` hides the entry for users who lack it (the API enforces it too). */
export type NavItem = { label: string; to: string; permission?: string }
export type NavGroup = { label: string; icon: LucideIcon; to?: string; permission?: string; items?: NavItem[] }

/** Sidebar menu — one group per business module from the rebuild plan. */
export const navigation: NavGroup[] = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/' },
  {
    label: 'Pawning',
    icon: Gem,
    items: [
      { label: 'New Pawn', to: '/pawning/new', permission: 'pawn.create' },
      { label: 'Part Payment', to: '/pawning/part-payment', permission: 'pawn.part_payment' },
      { label: 'Renewal', to: '/pawning/renewal', permission: 'pawn.renew' },
      { label: 'Redemption', to: '/pawning/redeem', permission: 'pawn.redeem' },
      { label: 'Ticket Search', to: '/pawning/search', permission: 'pawn.view' },
      { label: 'Opening Tickets', to: '/pawning/opening', permission: 'pawn.create_opening' },
      { label: 'Blocked Tickets', to: '/pawning/blocked', permission: 'pawn.block' },
      { label: 'Vault Stock Check', to: '/pawning/stock-check', permission: 'pawn.stock_check' },
    ],
  },
  {
    label: 'Arrears & Forfeit',
    icon: FileWarning,
    items: [
      { label: 'Arrears Letters', to: '/arrears/letters', permission: 'arrears.view' },
      { label: 'Forfeit Reminders', to: '/arrears/reminders', permission: 'forfeit.manage_promises' },
      { label: 'Forfeit Queue', to: '/forfeit/queue', permission: 'forfeit.queue' },
      { label: 'Transfer to Stock', to: '/forfeit/transfer', permission: 'forfeit.transfer_stock' },
    ],
  },
  { label: 'Customers', icon: Users, to: '/customers', permission: 'customers.view' },
  {
    label: 'Stock & Sales',
    icon: ShoppingCart,
    items: [
      { label: 'Sale Stock', to: '/inventory', permission: 'inventory.view' },
      { label: 'Sales Invoices', to: '/sales', permission: 'sales.create' },
    ],
  },
  {
    label: 'Accounting',
    icon: BookOpen,
    items: [
      { label: 'Cash Book', to: '/accounting/cash-book', permission: 'accounting.view' },
      { label: 'Day Closing', to: '/accounting/day-closing', permission: 'day_closing.close' },
      { label: 'Vouchers', to: '/accounting/vouchers', permission: 'vouchers.create' },
      { label: 'Journal Entries', to: '/accounting/journals', permission: 'journals.manage' },
      { label: 'Chart of Accounts', to: '/accounting/accounts', permission: 'accounts.manage' },
      { label: 'Trial Balance', to: '/accounting/trial-balance', permission: 'accounting.view' },
    ],
  },
  {
    label: 'Banking',
    icon: Landmark,
    items: [
      { label: 'Cheques', to: '/banking/cheques', permission: 'banking.view' },
      { label: 'Bank Accounts', to: '/banking/accounts', permission: 'banking.manage' },
      { label: 'Reconciliation', to: '/banking/reconciliation', permission: 'banking.reconcile' },
    ],
  },
  { label: 'Reports', icon: BarChart3, to: '/reports', permission: 'reports.view' },
  {
    label: 'Masters',
    icon: Boxes,
    items: [
      { label: 'Karats & Rates', to: '/masters/karats', permission: 'karat_rates.manage' },
      { label: 'Pawn Schemes', to: '/masters/schemes', permission: 'schemes.manage' },
      { label: 'Item Categories', to: '/masters/categories', permission: 'masters.manage' },
      { label: 'Item Setup', to: '/masters/article-types', permission: 'masters.manage' },
      { label: 'Conditions', to: '/masters/conditions', permission: 'masters.manage' },
      { label: 'Banks', to: '/masters/banks', permission: 'masters.manage' },
    ],
  },
  {
    label: 'Administration',
    icon: Settings,
    items: [
      { label: 'Users', to: '/admin/users', permission: 'users.manage' },
      { label: 'Roles & Permissions', to: '/admin/roles', permission: 'users.manage' },
      { label: 'Branches', to: '/admin/branches', permission: 'branches.manage' },
      { label: 'Company', to: '/admin/company', permission: 'branches.manage' },
      { label: 'Audit Log', to: '/admin/audit', permission: 'audit.view' },
    ],
  },
]

/** Menu filtered to what the user may open; empty groups are removed. */
export function visibleNavigation(can: (permission: string) => boolean): NavGroup[] {
  return navigation
    .map((g) => ({ ...g, items: g.items?.filter((i) => !i.permission || can(i.permission)) }))
    .filter((g) => (g.permission ? can(g.permission) : true))
    .filter((g) => g.to || (g.items && g.items.length > 0))
}

/** Permission needed for a path (used by the route guard). */
export function permissionForPath(pathname: string): string | undefined {
  for (const g of navigation) {
    if (g.to && g.to !== '/' && pathname.startsWith(g.to)) return g.permission
    for (const i of g.items ?? []) if (pathname.startsWith(i.to)) return i.permission
  }
  return undefined
}
