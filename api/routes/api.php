<?php

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
