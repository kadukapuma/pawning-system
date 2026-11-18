<?php

use App\Domain\Accounting\Http\Controllers\AccountingController;
use App\Domain\Arrears\Http\Controllers\ArrearsController;
use App\Domain\Banking\Http\Controllers\BankingController;
use App\Domain\Banking\Http\Controllers\BankController;
use App\Domain\Core\Http\Controllers\AuditLogController;
use App\Domain\Core\Http\Controllers\AuthController;
use App\Domain\Core\Http\Controllers\BranchAdminController;
use App\Domain\Core\Http\Controllers\UserAdminController;
use App\Domain\Customers\Http\Controllers\CustomerController;
use App\Domain\Masters\Http\Controllers\ArticleMasterController;
use App\Domain\Masters\Http\Controllers\KaratController;
use App\Domain\Masters\Http\Controllers\LookupController;
use App\Domain\Masters\Http\Controllers\PawnSchemeController;
use App\Domain\Pawning\Http\Controllers\PawnTicketController;
use App\Domain\Sales\Http\Controllers\SalesController;
use Illuminate\Support\Facades\Route;

/*
 * Permission checks live in the controllers ($this->authorize('perm.name'))
 * so each action documents what it needs.
 */
Route::prefix('v1')->group(function () {
    // Public health/info endpoint used by the SPA to confirm the API is reachable.
    Route::get('/ping', fn () => response()->json([
        'app' => config('app.name'),
        'time' => now()->toIso8601String(),
        'timezone' => config('app.timezone'),
    ]));

    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:login');

    // Everything below needs a signed-in user and runs inside one branch.
    Route::middleware(['auth:sanctum', 'branch'])->group(function () {
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/me', [AuthController::class, 'me']);

        // Dropdown data for forms.
        Route::get('/lookups', LookupController::class);
        Route::get('/company', [BranchAdminController::class, 'company']);

        // --- Customers -------------------------------------------------------
        Route::get('/customers', [CustomerController::class, 'index']);
        Route::post('/customers', [CustomerController::class, 'store']);
        Route::get('/customers/nic/{nic}', [CustomerController::class, 'byNic']);
        Route::get('/customers/{customer}', [CustomerController::class, 'show']);
        Route::put('/customers/{customer}', [CustomerController::class, 'update']);
        Route::put('/customers/{customer}/status', [CustomerController::class, 'updateStatus']);
        Route::put('/customers/{customer}/limits', [CustomerController::class, 'updateLimits']);

        // --- Pawning --------------------------------------------------------
        Route::get('/customers/{customer}/tickets', [PawnTicketController::class, 'forCustomer']);
        Route::post('/pawn-tickets/quote', [PawnTicketController::class, 'quote']);
        Route::post('/pawn-tickets/opening', [PawnTicketController::class, 'storeOpening']);
        Route::get('/pawn-tickets', [PawnTicketController::class, 'index']);
        Route::post('/pawn-tickets', [PawnTicketController::class, 'store']);
        Route::get('/pawn-tickets/{ticket}', [PawnTicketController::class, 'show']);
        Route::get('/pawn-tickets/{ticket}/statement', [PawnTicketController::class, 'statement']);
        Route::get('/pawn-tickets/{ticket}/part-payment/quote', [PawnTicketController::class, 'partPaymentQuote']);
        Route::post('/pawn-tickets/{ticket}/part-payment', [PawnTicketController::class, 'partPayment']);
        Route::get('/pawn-tickets/{ticket}/renewal/quote', [PawnTicketController::class, 'renewalQuote']);
        Route::post('/pawn-tickets/{ticket}/renewal', [PawnTicketController::class, 'renew']);
        Route::get('/pawn-tickets/{ticket}/redemption/quote', [PawnTicketController::class, 'redemptionQuote']);
        Route::post('/pawn-tickets/{ticket}/redemption', [PawnTicketController::class, 'redeem']);
        Route::post('/pawn-tickets/{ticket}/cancel', [PawnTicketController::class, 'cancel']);
        Route::put('/pawn-tickets/{ticket}/block', [PawnTicketController::class, 'block']);
        Route::get('/pawn-transactions/{id}', [PawnTicketController::class, 'transaction']);

        // --- Arrears & forfeit -------------------------------------------------
        Route::get('/arrears/letters/due', [ArrearsController::class, 'due']);
        Route::get('/arrears/letters/issued', [ArrearsController::class, 'issued']);
        Route::post('/arrears/letters/issue', [ArrearsController::class, 'issue']);
        Route::post('/arrears/letters/print', [ArrearsController::class, 'print']);
        Route::get('/forfeit/reminders', [ArrearsController::class, 'reminders']);
        Route::get('/pawn-tickets/{ticket}/promises', [ArrearsController::class, 'promises']);
        Route::post('/pawn-tickets/{ticket}/promises', [ArrearsController::class, 'storePromise']);
        Route::post('/pawn-tickets/{ticket}/unqueue', [ArrearsController::class, 'unqueue']);
        Route::get('/forfeit/queue', [ArrearsController::class, 'queued']);
        Route::post('/forfeit/queue', [ArrearsController::class, 'queue']);
        Route::post('/forfeit/execute', [ArrearsController::class, 'execute']);
        Route::get('/forfeit/awaiting-transfer', [ArrearsController::class, 'awaitingTransfer']);
        Route::post('/forfeit/transfer', [ArrearsController::class, 'transfer']);
        Route::get('/stock-transfer-batches/{batch}', [ArrearsController::class, 'batch']);

        // --- Stock & sales ----------------------------------------------------
        Route::get('/inventory', [SalesController::class, 'inventory']);
        Route::get('/inventory/code/{code}', [SalesController::class, 'lookup']);
        Route::put('/inventory/{item}/price', [SalesController::class, 'updatePrice']);
        Route::get('/sales', [SalesController::class, 'index']);
        Route::post('/sales', [SalesController::class, 'store']);
        Route::get('/sales/{invoice}', [SalesController::class, 'show']);
        Route::post('/sales/{invoice}/void', [SalesController::class, 'void']);

        // --- Accounting -------------------------------------------------------
        Route::get('/accounting/accounts', [AccountingController::class, 'accounts']);
        Route::get('/accounting/account-options', [AccountingController::class, 'accountOptions']);
        Route::post('/accounting/accounts', [AccountingController::class, 'storeAccount']);
        Route::put('/accounting/accounts/{account}', [AccountingController::class, 'updateAccount']);
        Route::get('/accounting/journals', [AccountingController::class, 'journals']);
        Route::post('/accounting/journals', [AccountingController::class, 'storeJournal']);
        Route::post('/accounting/journals/{journal}/reverse', [AccountingController::class, 'reverseJournal']);
        Route::get('/accounting/vouchers', [AccountingController::class, 'vouchers']);
        Route::post('/accounting/vouchers', [AccountingController::class, 'storeVoucher']);
        Route::post('/accounting/vouchers/{voucher}/approve', [AccountingController::class, 'approveVoucher']);
        Route::post('/accounting/vouchers/{voucher}/reject', [AccountingController::class, 'rejectVoucher']);
        Route::get('/accounting/cash-book', [AccountingController::class, 'cashBook']);
        Route::get('/accounting/day-closings', [AccountingController::class, 'closings']);
        Route::post('/accounting/day-closings', [AccountingController::class, 'closeDay']);
        Route::post('/accounting/day-closings/reopen', [AccountingController::class, 'reopenDay']);
        Route::get('/accounting/trial-balance', [AccountingController::class, 'trialBalance']);
        Route::get('/accounting/profit-and-loss', [AccountingController::class, 'profitAndLoss']);
        Route::get('/accounting/balance-sheet', [AccountingController::class, 'balanceSheet']);

        // --- Banking ----------------------------------------------------------
        Route::get('/banking/accounts', [BankingController::class, 'accounts']);
        Route::post('/banking/accounts', [BankingController::class, 'storeAccount']);
        Route::post('/banking/transfers', [BankingController::class, 'transfer']);
        Route::get('/banking/cheques', [BankingController::class, 'cheques']);
        Route::post('/banking/cheques/receive', [BankingController::class, 'receive']);
        Route::post('/banking/cheques/issue', [BankingController::class, 'issue']);
        Route::post('/banking/cheques/{cheque}/deposit', [BankingController::class, 'deposit']);
        Route::post('/banking/cheques/{cheque}/clear', [BankingController::class, 'clear']);
        Route::post('/banking/cheques/{cheque}/return', [BankingController::class, 'returnCheque']);
        Route::get('/banking/accounts/{bankAccount}/reconciliation', [BankingController::class, 'reconciliation']);
        Route::post('/banking/accounts/{bankAccount}/reconciliation', [BankingController::class, 'reconcile']);

        // --- Masters ---------------------------------------------------------
        Route::get('/karats', [KaratController::class, 'index']);
        Route::post('/karats', [KaratController::class, 'store']);
        Route::put('/karats/{karat}', [KaratController::class, 'update']);
        Route::get('/karats/{karat}/rates', [KaratController::class, 'history']);
        Route::post('/karat-rates', [KaratController::class, 'updateRates']);

        Route::get('/schemes', [PawnSchemeController::class, 'index']);
        Route::post('/schemes', [PawnSchemeController::class, 'store']);
        Route::get('/schemes/{scheme}', [PawnSchemeController::class, 'show']);
        Route::put('/schemes/{scheme}', [PawnSchemeController::class, 'update']);
        Route::post('/schemes/{scheme}/versions', [PawnSchemeController::class, 'storeVersion']);

        Route::get('/article-categories', [ArticleMasterController::class, 'categories']);
        Route::post('/article-categories', [ArticleMasterController::class, 'storeCategory']);
        Route::put('/article-categories/{category}', [ArticleMasterController::class, 'updateCategory']);
        Route::get('/article-types', [ArticleMasterController::class, 'types']);
        Route::post('/article-types', [ArticleMasterController::class, 'storeType']);
        Route::put('/article-types/{type}', [ArticleMasterController::class, 'updateType']);
        Route::get('/article-conditions', [ArticleMasterController::class, 'conditions']);
        Route::post('/article-conditions', [ArticleMasterController::class, 'storeCondition']);
        Route::put('/article-conditions/{condition}', [ArticleMasterController::class, 'updateCondition']);

        Route::get('/banks', [BankController::class, 'index']);
        Route::post('/banks', [BankController::class, 'store']);
        Route::put('/banks/{bank}', [BankController::class, 'update']);
        Route::post('/banks/{bank}/branches', [BankController::class, 'storeBranch']);
        Route::put('/banks/{bank}/branches/{branch}', [BankController::class, 'updateBranch']);

        // --- Administration ---------------------------------------------------
        Route::get('/admin/roles', [UserAdminController::class, 'roles']);
        Route::get('/admin/users', [UserAdminController::class, 'index']);
        Route::post('/admin/users', [UserAdminController::class, 'store']);
        Route::put('/admin/users/{user}', [UserAdminController::class, 'update']);
        Route::put('/admin/users/{user}/password', [UserAdminController::class, 'resetPassword']);

        Route::get('/admin/branches', [BranchAdminController::class, 'index']);
        Route::post('/admin/branches', [BranchAdminController::class, 'store']);
        Route::put('/admin/branches/{branch}', [BranchAdminController::class, 'update']);
        Route::put('/admin/company', [BranchAdminController::class, 'updateCompany']);

        Route::get('/admin/audit-logs', [AuditLogController::class, 'index']);
    });
});
