<?php

namespace App\Domain\Masters\Http\Controllers;

use App\Domain\Banking\Models\Bank;
use App\Domain\Core\Models\Branch;
use App\Domain\Customers\Models\Customer;
use App\Domain\Masters\Models\ArticleCategory;
use App\Domain\Masters\Models\ArticleCondition;
use App\Domain\Masters\Models\ArticleType;
use App\Domain\Masters\Models\Karat;
use App\Domain\Masters\Models\PawnScheme;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Spatie\Permission\Models\Role;

/** Everything the SPA needs to fill dropdowns, in one cached-per-session call. Active rows only. */
class LookupController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return response()->json(['data' => [
            'branches' => Branch::active()->orderBy('code')->get(['id', 'code', 'name']),
            'roles' => Role::orderBy('name')->pluck('name'),
            'karats' => Karat::active()->ordered()->with('currentRate')->get(),
            'article_categories' => ArticleCategory::where('is_active', true)->orderBy('name')->get(['id', 'name', 'metal']),
            'article_types' => ArticleType::where('is_active', true)->orderBy('name')->get(['id', 'category_id', 'code', 'name']),
            'article_conditions' => ArticleCondition::where('is_active', true)->orderBy('name')->get(['id', 'name']),
            'schemes' => PawnScheme::active()->with('currentVersion')->orderBy('code')->get(),
            'banks' => Bank::where('is_active', true)->with('branches:id,bank_id,code,name')->orderBy('name')->get(['id', 'code', 'name']),
            'customer_statuses' => Customer::STATUSES,
            'customer_titles' => Customer::TITLES,
        ]]);
    }
}
