import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuditLogPage } from '@/features/admin/AuditLogPage'
import { CompanyPage } from '@/features/admin/CompanyPage'
import { RolesPage } from '@/features/admin/RolesPage'
import { UsersPage } from '@/features/admin/UsersPage'
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage'
import { CustomersPage } from '@/features/customers/CustomersPage'
import { BanksPage } from '@/features/masters/BanksPage'
import { KaratsPage } from '@/features/masters/KaratsPage'
import { ArticleTypesPage, BranchesPage, CategoriesPage, ConditionsPage } from '@/features/masters/masterPages'
import { SchemesPage } from '@/features/masters/SchemesPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/LoginPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

// Permissions per path are enforced in AppLayout via navigation.ts (and by the API).
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'customers/:id', element: <CustomerDetailPage /> },
      { path: 'masters/karats', element: <KaratsPage /> },
      { path: 'masters/schemes', element: <SchemesPage /> },
      { path: 'masters/categories', element: <CategoriesPage /> },
      { path: 'masters/article-types', element: <ArticleTypesPage /> },
      { path: 'masters/conditions', element: <ConditionsPage /> },
      { path: 'masters/banks', element: <BanksPage /> },
      { path: 'admin/users', element: <UsersPage /> },
      { path: 'admin/roles', element: <RolesPage /> },
      { path: 'admin/branches', element: <BranchesPage /> },
      { path: 'admin/company', element: <CompanyPage /> },
      { path: 'admin/audit', element: <AuditLogPage /> },
      { path: '*', element: <PlaceholderPage /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
