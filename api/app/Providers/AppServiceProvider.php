<?php

namespace App\Providers;

use App\Domain\Accounting\Models\Account;
use App\Domain\Accounting\Models\AccountGroup;
use App\Domain\Accounting\Models\JournalEntry;
use App\Domain\Core\Models\Branch;
use App\Domain\Core\Models\Company;
use App\Domain\Core\Support\BranchContext;
use App\Models\User;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // One working branch per request (reset between requests / queue jobs).
        $this->app->scoped(BranchContext::class);
    }

    public function boot(): void
    {
        $this->registerSchemaMacros();

        // Catch lazy-loading / silently discarded attributes during development.
        Model::shouldBeStrict(! $this->app->isProduction());

        // Short, stable names in *_type columns (audit_logs, journal source, roles).
        Relation::enforceMorphMap([
            'user' => User::class,
            'branch' => Branch::class,
            'company' => Company::class,
            'account_group' => AccountGroup::class,
            'account' => Account::class,
            'journal_entry' => JournalEntry::class,
            'karat' => \App\Domain\Masters\Models\Karat::class,
            'article_category' => \App\Domain\Masters\Models\ArticleCategory::class,
            'article_type' => \App\Domain\Masters\Models\ArticleType::class,
            'article_condition' => \App\Domain\Masters\Models\ArticleCondition::class,
            'pawn_scheme' => \App\Domain\Masters\Models\PawnScheme::class,
            'bank' => \App\Domain\Banking\Models\Bank::class,
            'bank_branch' => \App\Domain\Banking\Models\BankBranch::class,
            'customer' => \App\Domain\Customers\Models\Customer::class,
            'pawn_ticket' => \App\Domain\Pawning\Models\PawnTicket::class,
            'pawn_transaction' => \App\Domain\Pawning\Models\PawnTransaction::class,
            'forfeiture' => \App\Domain\Forfeit\Models\Forfeiture::class,
            'stock_transfer_batch' => \App\Domain\Inventory\Models\StockTransferBatch::class,
            'inventory_item' => \App\Domain\Inventory\Models\InventoryItem::class,
            'sales_invoice' => \App\Domain\Sales\Models\SalesInvoice::class,
            'voucher' => \App\Domain\Accounting\Models\Voucher::class,
            'day_closing' => \App\Domain\Accounting\Models\DayClosing::class,
            'bank_account' => \App\Domain\Banking\Models\BankAccount::class,
            'cheque' => \App\Domain\Banking\Models\Cheque::class,
            'sms_setting' => \App\Domain\Sms\Models\SmsSetting::class,
            'sms_rule' => \App\Domain\Sms\Models\SmsRule::class,
            'sms_template' => \App\Domain\Sms\Models\SmsTemplate::class,
            'role' => \Spatie\Permission\Models\Role::class,
        ]);

        // super_admin passes every permission check.
        Gate::before(fn (User $user) => $user->hasRole('super_admin') ? true : null);

        // 5 login attempts per minute per username + IP.
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute(5)
            ->by(mb_strtolower((string) $request->input('username')).'|'.$request->ip()));
    }

    /**
     * Column helpers so every migration uses the same types (see docs/DB_DESIGN.md).
     */
    private function registerSchemaMacros(): void
    {
        // Money: decimal(15,2) NOT NULL DEFAULT 0.
        Blueprint::macro('money', function (string $column) {
            /** @var Blueprint $this */
            return $this->decimal($column, 15, 2)->default(0);
        });

        // Weight in grams: decimal(10,3) NOT NULL DEFAULT 0.
        Blueprint::macro('weight', function (string $column) {
            /** @var Blueprint $this */
            return $this->decimal($column, 10, 3)->default(0);
        });

        // Percentage rate: decimal(7,4) NOT NULL DEFAULT 0 (e.g. 2.5000 = 2.5%).
        Blueprint::macro('rate', function (string $column) {
            /** @var Blueprint $this */
            return $this->decimal($column, 7, 4)->default(0);
        });

        // Status / type columns backed by PHP enums.
        Blueprint::macro('status', function (string $column = 'status', ?string $default = null) {
            /** @var Blueprint $this */
            $col = $this->string($column, 20);

            return $default === null ? $col : $col->default($default);
        });

        // Nullable FK to users (who did it). Users are soft-deleted, never hard-deleted.
        Blueprint::macro('userRef', function (string $column) {
            /** @var Blueprint $this */
            return $this->foreignId($column)->nullable()->constrained('users')->restrictOnDelete();
        });

        // created_by + updated_by.
        Blueprint::macro('userStamps', function () {
            /** @var Blueprint $this */
            $this->userRef('created_by');
            $this->userRef('updated_by');
        });

        // Required FK to branches.
        Blueprint::macro('branchRef', function (string $column = 'branch_id') {
            /** @var Blueprint $this */
            return $this->foreignId($column)->constrained('branches')->restrictOnDelete();
        });
    }
}
