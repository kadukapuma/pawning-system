# Sampath Pawning — Rebuild Plan (Laravel API + React SPA)

## Context
`D:\sampath_pawning\sampath-old` is a Laravel 9 + Blade/jQuery gold & silver pawn-broking system for 2 branches (001, 002). It works, but:
- **DB:** 53 tables, **zero foreign keys**, receipts joined by text `(BC, Receipt_Number)`, money stored as varchar/float/`decimal(8,2)` (near overflow), dates as varchar, mixed collations, 13 dead tables, near-duplicate tables (`t_pawn_payments` / `t_redeem_sums` / `t_repawning_sums` / `t_forfeit_sums`; normal/opening/deleted copies of pawn tables).
- **Security:** most routes have no `auth`; `/register_user` can create an Admin without login; loan amount, interest rate, redeem totals and document numbers trusted from the browser; 36k customer receipt PDFs in public `public/assets/pdf/` with guessable names.
- **Logic:** good server-side services exist (`app/Services/*` — interest, part payment, repawn, arrears letters, forfeit) but are duplicated in Blade JS; account IDs, amount bands (50k/100k) and the 0.5% penalty are hard-coded; numbering races (`max()+1` without lock).

Goal: a new system in `D:\sampath_pawning\sampath-new` — **Laravel 12 REST API + separate React SPA**, new UI design, clean normalized schema with FKs and indexes, **proper double-entry accounting**, **fresh start** (no ETL; active loans keyed in via an "Opening Ticket" screen), plus **Sales of forfeited stock** and **Banking/Cheques**. No auction module (old system had none). UI English only; arrears letters keep the trilingual pre-printed stationery layout.

---

## 1. Old system — module map (what we must reproduce)

| # | Module | Old source (port the rules from) | Key rules |
|---|---|---|---|
| 1 | Customers | `CustomerController`, `Services/CustomerPawnPolicy.php`, `CustomerContactSyncService.php` | Keyed by NIC; amount & active-count limits; limit can't go below exposure; contact change logged |
| 2 | New pawn | `PawnController.php`, `views/pawnReceipt.blade.php:784,1840-1955` | Article value = (karat pawn rate ÷ 8) × weight; loan ≤ total value; term = month (1–12) where `value − monthInterest×(m−1)` closest to loan; SILVER category ⇒ SILVER scheme; maturity = pawn date + months (Silver: + valid days) |
| 3 | Receipt types (schemes) | `ReceiptController`, `ReceiptTypeResolver.php`, `ReceiptTypeForwardTerms.php` | Versioned (edit = close row + new row, no future dating); A/B/C chosen by amount band; interest terms frozen per ticket, non-interest terms (service, postage, letter days) follow current version |
| 4 | Interest | `ReceiptFinancialCalculator.php:98-238`, `SilverInterest.php`, `ReceiptInterestPeriod.php` | Days inclusive from cycle start; tiered flat rate1/rate2/rate3 ≤ 30 days, then rate3 × months + rate3/30 × days; type D penalty; Silver min one period then daily; net = gross − paid + carried |
| 5 | Part payment | `PawningPartPaymentController`, `PartPaymentCalculator.php:247-283` | Interest + postage first, then capital; unpaid interest capitalised; no service/stamp; can't pay full (use redeem); min remaining capital 1,000; new cycle starts next day; re-band scheme; clears letter state |
| 6 | Renewal (repawn) | `RepawningController`, `RepawningCalculator.php:310-341` | New principal = principal + extra cash + interest + service + letter + stamp − discount; value at today's karat rate; blocked tickets rejected |
| 7 | Redemption | `RedeemController`, `ReceiptPaymentEligibility.php:590-614` | Lock row, branch/open/not-blocked; capital + arrears − discount; < Rs 5 rounding row |
| 8 | Arrears letters | `RedeemLateLettersController`, `ArrearsLetterService.php`, `ReceiptPenaltySchedule.php:429-558` | L1 due at expiry; L(n) due = actual print of L(n−1) + letter_n_days (default 21); idempotent per (ticket, cycle, letter); postage once; service charge on L1 |
| 9 | Forfeit reminders → forfeit → stock | `ForfeitReminderService.php`, `ForfeitReceiptController`, `ForfeitArticleTransferService.php` | Reminder at L3 + 21 days; promises (pending/extended/kept/broken); manual queue → manual forfeit (management only); articles → sale stock in one locked transaction |
| 10 | Block receipts | `BlockedReceiptController` | Admin only, reason required; blocks redeem & renew (part payment allowed) |
| 11 | Receipt history / search | `ReceiptHistoryService.php` | Oldest-first DR/CR ledger with service & letter rows, lifecycle timeline, printable |
| 12 | Opening (legacy) tickets | `OpeningPawnController` | Manual entry of tickets from paper system — becomes `is_opening` flag on normal tickets |
| 13 | Cash book / vouchers / expenses | `DailyCashReportController`, `PaymentVoucherController`, `GentralReceiptController`, `ExpenseController` | Daily open/close balance per branch; voucher approve → post |
| 14 | Sales of forfeited stock | `InvoiceController`, `SalesController` | Sale price = (sale rate ÷ 8) × weight; item sold once |
| 15 | Stock check (vault audit) | `StockDetailsCheckController` | Tick each active ticket physically present |
| 16 | Masters | karatage, categories, item setup, conditions, branches, company, banks | Karat rates per 8 g (pawn/assess/market/sale) |
| 17 | Users / roles | `UserController` (4 inconsistent admin checks) | → replace with spatie roles/permissions |
| 18 | Reports | ~12 report controllers | Pawning, articles, redeem, renewal, part payment, forfeit, daily summary, deleted/cancelled, letters, sales |
| 19 | Prints | `views/*Print.blade.php` | Pawn receipt (half-A4 pre-printed), pawn ticket, renewal, part payment, redeem, trilingual arrears letter, history, forfeit transfer, sales invoice |

---

## 2. Tech stack & structure

```
sampath-new/
  api/   Laravel 12, PHP 8.3, MySQL 8 (utf8mb4_unicode_ci), Sanctum (SPA cookie auth),
         spatie/laravel-permission, barryvdh/laravel-dompdf, Pest tests
  web/   React 19 + TypeScript + Vite, React Router, TanStack Query, react-hook-form + zod,
         Tailwind + shadcn/ui, TanStack Table, Recharts
```
API layout: `app/Domain/{Customers,Pawning,Arrears,Forfeit,Inventory,Sales,Accounting,Banking,Masters}/` each with `Models/ Actions/ Services/ Enums/ Http/(Controllers,Requests,Resources) Policies/`.

Cross-cutting:
- `BelongsToBranch` trait + global scope (branch from authenticated user; head-office roles may switch via `X-Branch-Id`, validated against `user_branches`).
- `SequenceService::next($branchId, $docType)` — `SELECT … FOR UPDATE` on `document_sequences` (fixes all numbering races).
- `LedgerPoster` — every financial action posts a balanced journal via `accounts.system_key` (no hard-coded IDs).
- All amounts computed server-side; client only sends inputs (weights, karat, requested loan, payment amount, discount). Discount capped by permission.
- PDFs written to `storage/app/private/documents/{branch}/{type}/…`, served only via authenticated, branch-scoped endpoint.
- PHP backed enums for every status/type column (stored as `varchar(20)`).

Roles (spatie): `super_admin`, `head_office`, `branch_manager`, `cashier`, `valuer`, `accountant`, `auditor`. Permissions per action (e.g. `pawn.create`, `pawn.redeem`, `pawn.block`, `forfeit.execute`, `discount.grant`, `voucher.approve`, `scheme.manage`).

---

## 3. New DB design

Conventions: `id` bigint unsigned AI on every table; FKs `->constrained()->restrictOnDelete()` (cascade only for child line tables); money `decimal(15,2)`; weight `decimal(10,3)`; rates `decimal(7,4)`; dates `date`/`datetime`; booleans `NOT NULL DEFAULT 0`; `created_by`/`updated_by` FK users where noted; timezone Asia/Colombo.

### 3.1 Foundation
| Table | Columns | Indexes |
|---|---|---|
| `companies` | name, reg_no, address, phone, email, logo_path, receipt_footer, timestamps | — |
| `branches` | code char(3), name, address, phone1, phone2, opened_on, is_active, timestamps, soft deletes | UQ(code) |
| `users` | branch_id FK, username, name, email null, phone, password, is_active, last_login_at, remember_token, timestamps, soft deletes | UQ(username), UQ(email), IX(branch_id, is_active) |
| `user_branches` | user_id FK, branch_id FK | PK(user_id, branch_id) |
| spatie tables | roles, permissions, model_has_roles, model_has_permissions, role_has_permissions | package defaults |
| `personal_access_tokens`, `sessions`, `jobs`, `failed_jobs`, `cache` | Laravel defaults | defaults |
| `document_sequences` | branch_id FK, doc_type varchar(30), prefix varchar(10), next_number bigint, padding tinyint | UQ(branch_id, doc_type) |
| `settings` | branch_id FK null, key varchar(60), value json | UQ(branch_id, key) |
| `audit_logs` | user_id FK null, branch_id FK null, auditable_type, auditable_id, event varchar(30), old_values json, new_values json, ip, user_agent, created_at | IX(auditable_type, auditable_id), IX(user_id, created_at), IX(branch_id, created_at) |

### 3.2 Masters
| Table | Columns | Indexes |
|---|---|---|
| `karats` | code ('22K'), name, purity decimal(5,2), sort_order, is_active | UQ(code) |
| `karat_rates` | karat_id FK, effective_from datetime, pawn_rate_per_8g, assess_rate_per_8g, market_rate_per_8g, sale_rate_per_8g (decimal 12,2), created_by | IX(karat_id, effective_from) — "latest ≤ now" lookup |
| `article_categories` | name, metal varchar(10) (gold/silver/other), is_active | UQ(name) |
| `article_types` | category_id FK, code, name, is_active | UQ(code), UQ(category_id, name) |
| `article_conditions` | name, is_active | UQ(name) |
| `pawn_schemes` | code ('A','B','C','SILVER','D'), name, metal, interest_method (tiered / monthly_penalty / silver), is_active, timestamps | UQ(code) |
| `pawn_scheme_versions` (immutable) | scheme_id FK, effective_from date, effective_to date null, min_amount, max_amount null, valid_months tinyint, valid_days smallint, period1_days, rate1, period2_days, rate2, period3_days, rate3, penalty_rate_monthly, document_charge, stamp_duty, service_charge_flat, service_charge_threshold, service_charge_percent, postage_charge, letter_1_days, letter_2_days, letter_3_days, forfeit_reminder_days (default 21), min_capital_after_part_payment (1000), max_term_months (12), created_by, created_at | IX(scheme_id, effective_from, effective_to), IX(effective_from, min_amount) |

### 3.3 Customers
| Table | Columns | Indexes |
|---|---|---|
| `customers` | branch_id FK (registered at), code varchar(20), title, first_name, middle_name, last_name, full_name (stored), gender, nic varchar(20), driving_license, passport, other_identification, date_of_birth, address_line1, address_line2, city, phone1, phone2, email, photo_path, status (active/inactive/blacklisted), pawn_amount_limit null, pawn_count_limit null, notes, created_by, updated_by, timestamps, soft deletes | **UQ(nic)**, UQ(code), IX(phone1), IX(branch_id, status), IX(full_name), FULLTEXT(full_name, address_line1) |
| `customer_documents` | customer_id FK cascade, type, file_path, uploaded_by, created_at | IX(customer_id) |

One customer record globally (old allowed same NIC per branch — causes duplicate limit logic).

### 3.4 Pawning core
**`pawn_tickets`** (replaces t_pawn_sums, t_opening_pawn_sums, t_delete_pawn_sums, receipts, cancel__pawnings)
- branch_id FK, customer_id FK, scheme_id FK, scheme_version_id FK (frozen interest terms — versions are immutable, so no 20-column snapshot)
- receipt_no, ticket_no, stock_no (varchar 20, per-branch sequences)
- pawn_date date, cycle_start_date date, maturity_date date, valid_months tinyint
- gross_weight, net_weight (10,3); assessed_value, market_value, principal_original, principal_current, interest_carried, interest_paid_cycle (15,2)
- status (active / redeemed / forfeited / cancelled), arrears_stage (none / letter_1 / letter_2 / letter_3 / reminder / forfeit_queued), letter_cycle smallint default 1
- is_blocked, blocked_at, blocked_by FK, block_reason
- forfeit_queued_at, redeemed_at, forfeited_at, cancelled_at, cancelled_by FK, cancel_reason
- is_opening bool, legacy_receipt_no null
- created_by, updated_by, timestamps
- Indexes: **UQ(branch_id, receipt_no)**, UQ(branch_id, ticket_no), UQ(branch_id, stock_no), IX(customer_id, status), IX(branch_id, status, maturity_date), IX(branch_id, arrears_stage, status), IX(branch_id, pawn_date), IX(status, forfeit_queued_at), IX(legacy_receipt_no)

**`pawn_ticket_items`** (replaces t_pawn_details, t_opening_pawn_details, t_delete_pawn_details, t_forfit_details)
- pawn_ticket_id FK cascade, category_id FK, article_type_id FK, condition_id FK, karat_id FK, description, quantity smallint, gross_weight, net_weight, karat_rate_per_8g (snapshot), assessed_value, market_value, status (pledged / redeemed / forfeited / in_stock / sold), photo_path
- IX(pawn_ticket_id), IX(status), IX(karat_id)

**`pawn_transactions`** (one table replaces t_pawn_trans, t_pawn_payments, t_redeem_sums, t_repawning_sums, t_forfeit_sums, t_customer_accounts)
- branch_id FK, pawn_ticket_id FK, txn_no varchar(20), type (pawn / part_payment / renewal / redemption / forfeit / letter_charge / rounding / cancellation / reversal)
- txn_at datetime, business_date date, interest_days smallint
- principal_before, interest_due, interest_paid, interest_capitalised, service_charge, postage_charge, document_charge, stamp_duty, discount, principal_paid, principal_added, principal_after, cash_received, cash_paid (all 15,2)
- new_maturity_date null, new_scheme_version_id FK null, payment_method (cash / cheque / bank), cheque_id FK null
- reversal_of_id FK self null, journal_entry_id FK null, remarks, created_by
- Indexes: **UQ(branch_id, txn_no)**, IX(pawn_ticket_id, txn_at), IX(branch_id, type, business_date), IX(created_by, business_date), IX(journal_entry_id)

**Arrears / lifecycle**
| Table | Columns | Indexes |
|---|---|---|
| `arrears_letters` | pawn_ticket_id FK, branch_id FK, cycle_no smallint, letter_no tinyint, due_date, issued_at, postage_charge, service_charge, issued_by FK, reprint_count, last_reprinted_at | **UQ(pawn_ticket_id, cycle_no, letter_no)**, IX(branch_id, issued_at), IX(due_date) |
| `forfeit_promises` | pawn_ticket_id FK, cycle_no, promise_date, remark, status (pending/extended/kept/broken), previous_promise_id FK self, created_by, updated_by, timestamps | IX(pawn_ticket_id, cycle_no, status), IX(promise_date, status) |
| `pawn_ticket_events` | pawn_ticket_id FK, event_type varchar(40), event_at, amount null, description, payload json, user_id FK | IX(pawn_ticket_id, event_at), IX(event_type, event_at) |
| `pawn_remarks` | pawn_ticket_id FK, customer_id FK, remark text, user_id FK, created_at | IX(pawn_ticket_id), IX(customer_id) |
| `stock_check_sessions` | branch_id FK, started_at, completed_at, started_by, status | IX(branch_id, started_at) |
| `stock_check_lines` | session_id FK cascade, pawn_ticket_id FK, checked_at, checked_by | UQ(session_id, pawn_ticket_id) |

### 3.5 Forfeit, inventory, sales
| Table | Columns | Indexes |
|---|---|---|
| `forfeitures` | branch_id FK, forfeit_no, pawn_ticket_id FK, forfeit_date, principal_at_forfeit, interest_at_forfeit, charges_at_forfeit, total_due, approved_by FK, created_by, journal_entry_id FK | UQ(branch_id, forfeit_no), **UQ(pawn_ticket_id)** |
| `stock_transfer_batches` | branch_id FK, batch_no, transferred_at, user_id FK, notes | UQ(branch_id, batch_no) |
| `inventory_items` | branch_id FK, item_code, barcode, source (forfeit/purchase), forfeiture_id FK null, pawn_ticket_item_id FK null, transfer_batch_id FK null, category_id, article_type_id, karat_id, description, quantity, gross_weight, net_weight, cost_price, sale_price, status (in_stock/reserved/sold/written_off), received_at, sold_at | UQ(item_code), UQ(barcode), UQ(pawn_ticket_item_id), IX(branch_id, status), IX(category_id, status) |
| `stock_movements` | inventory_item_id FK, branch_id FK, movement_type (forfeit_in/sale/return/adjustment/write_off), qty_in, qty_out, reference_type, reference_id, moved_at, user_id | IX(inventory_item_id, moved_at), IX(branch_id, movement_type, moved_at), IX(reference_type, reference_id) |
| `sales_invoices` | branch_id FK, invoice_no, invoice_date, customer_id FK null, customer_name, customer_phone, gross_amount, discount, net_amount, paid_cash, paid_card, paid_cheque, credit_amount, status (completed/voided), voided_by, void_reason, journal_entry_id FK, created_by | UQ(branch_id, invoice_no), IX(branch_id, invoice_date), IX(customer_id) |
| `sales_invoice_lines` | sales_invoice_id FK cascade, inventory_item_id FK, description, qty, unit_price, discount, line_total | IX(sales_invoice_id), IX(inventory_item_id) |

### 3.6 Accounting (double-entry)
| Table | Columns | Indexes |
|---|---|---|
| `account_groups` | code, name, type (asset/liability/equity/income/expense), parent_id FK self | UQ(code) |
| `accounts` | code varchar(20), name, account_group_id FK, type, normal_balance (debit/credit), branch_id FK null (null = all branches), is_cash, is_bank, is_system, system_key varchar(40) null, opening_balance, is_active | UQ(code), **UQ(system_key)**, IX(type, is_active) |
| `journal_entries` | branch_id FK, entry_no, entry_date date, source_type, source_id, narration, status (posted/reversed), reversal_of_id FK self, posted_by, posted_at, created_by | UQ(branch_id, entry_no), IX(branch_id, entry_date), IX(source_type, source_id) |
| `journal_lines` | journal_entry_id FK cascade, account_id FK, branch_id FK, entry_date (denorm), debit, credit, description, pawn_ticket_id FK null, customer_id FK null | IX(account_id, entry_date), IX(branch_id, account_id, entry_date), IX(journal_entry_id), IX(pawn_ticket_id) |
| `day_closings` | branch_id FK, business_date, opening_cash, total_in, total_out, closing_cash, physical_cash null, variance, status (open/closed), closed_by, closed_at | **UQ(branch_id, business_date)** |
| `vouchers` (payment voucher, general receipt, expense, petty cash) | branch_id FK, voucher_no, type, voucher_date, party_name, account_id FK, cash_account_id FK, amount, description, status (draft/pending/approved/rejected/posted), requested_by, approved_by, approved_at, attachment_path, journal_entry_id FK | UQ(branch_id, voucher_no), IX(branch_id, status, voucher_date), IX(type, voucher_date) |

System accounts seeded by `system_key`: `cash`, `pawn_loans_receivable`, `interest_income`, `service_charge_income`, `postage_income`, `document_charge_income`, `stamp_duty_payable`, `discount_allowed`, `rounding`, `forfeited_stock`, `sales_income`, `cost_of_sales`, `cheques_in_hand`.
Posting examples: Pawn → Dr Loans / Cr Cash. Redemption → Dr Cash, Dr Discount / Cr Loans, Cr Interest Income, Cr Service, Cr Postage. Capitalised interest → Dr Loans / Cr Interest Income. Forfeit → Dr Forfeited Stock / Cr Loans (+ accrued interest per policy).

### 3.7 Banking
| Table | Columns | Indexes |
|---|---|---|
| `banks` | code, name | UQ(code) |
| `bank_branches` | bank_id FK, code, name | UQ(bank_id, code) |
| `bank_accounts` | branch_id FK, bank_branch_id FK, account_no, account_name, account_id FK (chart), is_active | UQ(account_no), UQ(account_id) |
| `cheques` | branch_id FK, direction (received/issued), cheque_no, bank_branch_id FK, bank_account_id FK null, party_name, amount, cheque_date, status (in_hand/deposited/cleared/returned/issued/presented/cancelled), deposited_at, cleared_at, returned_at, return_reason, source_type, source_id, journal_entry_id FK | IX(branch_id, status, cheque_date), IX(bank_account_id, status), IX(cheque_no), IX(source_type, source_id) |
| `bank_reconciliations` | bank_account_id FK, statement_date, statement_balance, book_balance, status, reconciled_by | UQ(bank_account_id, statement_date) |
| `bank_reconciliation_lines` | reconciliation_id FK cascade, journal_line_id FK, cleared_date | UQ(journal_line_id) |

### 3.8 Documents
| `printed_documents` | branch_id FK, document_type, documentable_type, documentable_id, file_path (private), print_count, printed_by, last_printed_at | IX(documentable_type, documentable_id), IX(branch_id, document_type) |

**Total ≈ 45 tables** (vs 53 old), every relation enforced by FK.

---

## 4. Implementation phases
1. **Scaffold** — `api/` (Laravel 12, Sanctum, spatie, dompdf, Pest) and `web/` (Vite React TS, Tailwind, shadcn). Write `docs/DB_DESIGN.md` + ER diagram from §3.
2. **Migrations & seeders** — all tables in §3 in dependency order; seed roles/permissions, system accounts, karats, schemes A/B/C/SILVER with versions, 2 branches, super admin.
3. **Auth & core** — login, `BelongsToBranch` scope, `SequenceService`, `LedgerPoster`, audit observer, policies.
4. **Masters + customers** API & screens.
5. **Calculation engine** (pure PHP, unit-tested first): port `ReceiptFinancialCalculator`, `SilverInterest`, `ReceiptInterestPeriod`, `PartPaymentCalculator`, `RepawningCalculator`, `ReceiptTypeResolver`, `ReceiptPenaltySchedule`, `CustomerPawnPolicy`. Re-use old `tests/Unit` cases as golden values.
6. **Pawning flows** — new pawn, opening ticket, part payment, renewal, redemption, cancel, block, receipt search/ledger, prints.
7. **Arrears & forfeit** — letter queues + bulk trilingual print, promises, forfeit queue, forfeit, transfer to stock.
8. **Inventory & sales** — stock list, sales invoice, void.
9. **Accounting & banking** — chart, vouchers (maker-checker), day closing, cash book, trial balance, P&L, balance sheet, cheques, reconciliation.
10. **Dashboard & reports** — all old reports + exports (Excel/PDF).
11. **Hardening** — rate limiting, backups, deployment (API on PHP-FPM, SPA static build).

## 5. Verification
- `php artisan migrate:fresh --seed` runs cleanly on MySQL 8; `SHOW INDEX` confirms indexes; FK violations rejected.
- Pest unit tests for every calculator, using numbers from the old `tests/Unit` and hand-checked old receipts (gold tiered, type D penalty, Silver, part-payment capitalisation, renewal, rounding < Rs 5).
- Feature tests per flow: pawn → part pay → renew → letters 1-3 → promise → forfeit → transfer → sale; assert ticket state, `pawn_transactions`, and **journal balances (Σdebit = Σcredit)**.
- Concurrency test: parallel pawn creation yields no duplicate receipt numbers.
- Branch isolation tests: cashier of 001 cannot read/act on 002 records; unauthenticated requests → 401.
- Manual run: `php artisan serve` + `npm run dev`, walk each screen in the browser pane and compare printed PDFs to the old templates.
