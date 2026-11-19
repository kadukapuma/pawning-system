import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { AuditLogPage } from '@/features/admin/AuditLogPage'
import { CompanyPage } from '@/features/admin/CompanyPage'
import { RolesPage } from '@/features/admin/RolesPage'
import { UsersPage } from '@/features/admin/UsersPage'
import { ArrearsLettersPage } from '@/features/arrears/ArrearsLettersPage'
import { LettersPrintPage, TransferPrintPage } from '@/features/arrears/ArrearsPrintPages'
import { ForfeitQueuePage, ForfeitRemindersPage, TransferToStockPage } from '@/features/arrears/ForfeitPages'
import { CustomerDetailPage } from '@/features/customers/CustomerDetailPage'
import { CustomersPage } from '@/features/customers/CustomersPage'
import { BanksPage } from '@/features/masters/BanksPage'
import { KaratsPage } from '@/features/masters/KaratsPage'
import { ArticleTypesPage, BranchesPage, CategoriesPage, ConditionsPage } from '@/features/masters/masterPages'
import { SchemesPage } from '@/features/masters/SchemesPage'
import { PawnFormPage } from '@/features/pawning/PawnFormPage'
import { TicketPrintPage, TransactionPrintPage } from '@/features/pawning/PrintPages'
import { TicketDetailPage } from '@/features/pawning/TicketDetailPage'
import { TicketSearchPage } from '@/features/pawning/TicketSearchPage'
import { ChartOfAccountsPage, JournalsPage } from '@/features/accounting/AccountsPages'
import { CashBookPage, StatementsPage, VouchersPage } from '@/features/accounting/CashPages'
import { BankAccountsPage, ChequesPage, ReconciliationPage } from '@/features/banking/BankingPages'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { StockCheckPage } from '@/features/reports/StockCheckPage'
import { InventoryPage } from '@/features/sales/InventoryPage'
import { InvoicePrintPage, NewSalePage, SalesListPage } from '@/features/sales/SalesPages'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/LoginPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { RouteError } from '@/pages/RouteError'

// Permissions per path are enforced in AppLayout via navigation.ts (and by the API).
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/print/ticket/:id', element: <TicketPrintPage /> },
  { path: '/print/transaction/:id', element: <TransactionPrintPage /> },
  { path: '/print/letters', element: <LettersPrintPage /> },
  { path: '/print/transfer/:id', element: <TransferPrintPage /> },
  { path: '/print/invoice/:id', element: <InvoicePrintPage /> },
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [{
      // Pathless wrapper: a crashing page shows RouteError inside the layout (menu stays usable).
      errorElement: <RouteError />,
      children: [
      { index: true, element: <DashboardPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'customers/:id', element: <CustomerDetailPage /> },
      { path: 'pawning/new', element: <PawnFormPage key="new" mode="new" /> },
      { path: 'pawning/opening', element: <PawnFormPage key="opening" mode="opening" /> },
      { path: 'pawning/search', element: <TicketSearchPage key="search" mode="search" /> },
      { path: 'pawning/part-payment', element: <TicketSearchPage key="pp" mode="part-payment" /> },
      { path: 'pawning/renewal', element: <TicketSearchPage key="rn" mode="renewal" /> },
      { path: 'pawning/redeem', element: <TicketSearchPage key="rd" mode="redeem" /> },
      { path: 'pawning/blocked', element: <TicketSearchPage key="bl" mode="blocked" /> },
      { path: 'pawning/tickets/:id', element: <TicketDetailPage /> },
      { path: 'arrears/letters', element: <ArrearsLettersPage /> },
      { path: 'arrears/reminders', element: <ForfeitRemindersPage /> },
      { path: 'forfeit/queue', element: <ForfeitQueuePage /> },
      { path: 'forfeit/transfer', element: <TransferToStockPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'sales', element: <SalesListPage /> },
      { path: 'sales/new', element: <NewSalePage /> },
      { path: 'accounting/accounts', element: <ChartOfAccountsPage /> },
      { path: 'accounting/journals', element: <JournalsPage /> },
      { path: 'accounting/vouchers', element: <VouchersPage /> },
      { path: 'accounting/cash-book', element: <CashBookPage key="book" /> },
      { path: 'accounting/day-closing', element: <CashBookPage key="close" closing /> },
      { path: 'accounting/trial-balance', element: <StatementsPage /> },
      { path: 'banking/accounts', element: <BankAccountsPage /> },
      { path: 'banking/cheques', element: <ChequesPage /> },
      { path: 'banking/reconciliation', element: <ReconciliationPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'reports/:report', element: <ReportsPage /> },
      { path: 'pawning/stock-check', element: <StockCheckPage /> },
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
    }],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
