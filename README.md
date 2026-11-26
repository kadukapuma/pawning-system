# Sampath Pawning (new system)

Rebuild of `../sampath-old` as a Laravel 12 REST API + React SPA.

| Folder | What |
|---|---|
| `api/` | Laravel 12 · PHP 8.3 · MySQL 8.4 · Sanctum (SPA cookie auth) · spatie/laravel-permission · dompdf · Pest |
| `web/` | React 19 · TypeScript · Vite · Tailwind 4 (shadcn tokens) · React Router · TanStack Query/Table · react-hook-form + zod |
| `docs/` | `REBUILD_PLAN_AND_DB_DESIGN.md` (plan), `DB_DESIGN.md` (schema + ER diagram) |
| `tools/` | `composer.phar` (no global Composer on this machine) |

## Run locally

1. Start MySQL from WAMP and create the database `sampath_new` (utf8mb4_unicode_ci). **Do not use `sampath_pawning` — it holds the old system's live data.**
2. API:
   ```bash
   cd api
   php artisan migrate:fresh --seed   # rebuilds sampath_new with reference data (needs SEED_ADMIN_PASSWORD in .env)
   php artisan serve --port=8010      # http://localhost:8010
   ```
   Composer: `php ../tools/composer.phar install`
   Tests: create database `sampath_new_testing`, then `./vendor/bin/pest`
3. Web:
   ```bash
   cd web
   npm install
   npm run dev                  # http://localhost:5173 (proxies /api and /sanctum to :8010)
   ```

## SMS (Notify.lk)
- Fill the `NOTIFYLK_*` values in `api/.env`, then set up messages in the app under **SMS > SMS Settings**. Everything starts switched off.
- Existing database: `php artisan migrate`, then `php artisan db:seed --class=SmsSeeder` and `php artisan db:seed --class=RolesAndPermissionsSeeder`.
- Automatic reminders and queued bulk messages need the scheduler: a cron entry running `php artisan schedule:run` every minute (locally `php artisan schedule:work`).
- Code is in `api/app/Domain/Sms` and `web/src/features/sms`.

## Signing in (local)
- `admin` (super admin) — password is `SEED_ADMIN_PASSWORD` in `api/.env`.
- Demo users for each role (local only) — `manager001`, `cashier001`, `cashier002`, `valuer001`, `accountant`, `auditor` — password is `SEED_DEMO_PASSWORD` in `api/.env`.
- Change these before any shared or production use.

## Core building blocks (api/app/Domain/Core, Accounting)
- `BranchContext` + `ResolveBranch` middleware (`X-Branch-Id` header) + `BelongsToBranch` trait — every branch-owned model is filtered to the working branch.
- `SequenceService::next('receipt')` — locked, gapless per-branch numbers.
- `LedgerPoster::post([...JournalLineData])` — balanced double-entry journals; `reverse()` for corrections.
- `Money` — exact 2-dp arithmetic (bcmath); never use floats for money.
- `Auditable` trait — writes created/updated/deleted (and custom events) to `audit_logs`.

## Conventions
- Domain code lives in `api/app/Domain/<Module>/{Models,Actions,Services,Enums,Http,Policies}`.
- All money math happens on the server; the SPA only sends inputs.
- Never trust document numbers from the client — `SequenceService` issues them under a row lock.
