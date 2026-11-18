<?php

use App\Models\User;
use Database\Seeders\DocumentSequenceSeeder;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Spatie\Permission\Models\Role;

it('seeds both branches and the company', function () {
    expect(DB::table('branches')->orderBy('code')->pluck('name', 'code')->all())
        ->toBe(['001' => 'Balangoda', '002' => 'Rathnapura']);
    expect(DB::table('companies')->count())->toBe(1);
});

it('seeds a super admin whose password is hashed and who can access every branch', function () {
    $admin = User::where('username', 'admin')->firstOrFail();

    expect($admin->hasRole('super_admin'))->toBeTrue()
        ->and(Hash::check('test-only-password-123', $admin->password))->toBeTrue()
        ->and($admin->password)->not->toBe('test-only-password-123')
        ->and(DB::table('user_branches')->where('user_id', $admin->id)->count())->toBe(2);
});

it('seeds every role with permissions that exist', function () {
    expect(Role::pluck('name')->sort()->values()->all())->toBe([
        'accountant', 'auditor', 'branch_manager', 'cashier', 'head_office', 'super_admin', 'valuer',
    ]);

    foreach (Role::with('permissions')->get() as $role) {
        expect($role->permissions)->not->toBeEmpty("{$role->name} has no permissions");
    }

    expect(Role::findByName('super_admin')->permissions)->toHaveCount(count(RolesAndPermissionsSeeder::PERMISSIONS));
    expect(Role::findByName('cashier')->hasPermissionTo('pawn.block'))->toBeFalse();
    expect(Role::findByName('auditor')->hasPermissionTo('pawn.create'))->toBeFalse();
});

it('seeds the four pawn schemes with non-overlapping amount bands', function () {
    $versions = DB::table('pawn_scheme_versions as v')
        ->join('pawn_schemes as s', 's.id', '=', 'v.scheme_id')
        ->whereNull('v.effective_to')
        ->orderBy('s.code')
        ->get(['s.code', 'v.min_amount', 'v.max_amount', 'v.rate3', 'v.valid_days']);

    expect($versions->pluck('code')->all())->toBe(['A', 'B', 'C', 'SILVER']);

    $gold = $versions->whereIn('code', ['A', 'B', 'C'])->values();
    expect((float) $gold[0]->max_amount)->toBeLessThan((float) $gold[1]->min_amount)
        ->and((float) $gold[1]->max_amount)->toBeLessThan((float) $gold[2]->min_amount)
        ->and($gold[2]->max_amount)->toBeNull()
        ->and((float) $gold[0]->rate3)->toBe(2.5);
});

it('seeds karat grades with a current rate each', function () {
    expect(DB::table('karats')->count())->toBe(16);
    expect(DB::table('karats')->whereNotExists(
        fn ($q) => $q->from('karat_rates')->whereColumn('karat_rates.karat_id', 'karats.id')
    )->count())->toBe(0);

    // The old 10x data-entry error on A2's assess rate is corrected.
    $a2 = DB::table('karat_rates')->join('karats', 'karats.id', '=', 'karat_rates.karat_id')
        ->where('karats.code', 'A2')->value('assess_rate_per_8g');
    expect((float) $a2)->toBe(290000.0);
});

it('maps every article type to a seeded category', function () {
    expect(DB::table('article_types')->count())->toBe(169)
        ->and(DB::table('article_categories')->count())->toBe(24)
        ->and(DB::table('article_conditions')->count())->toBe(16);
});

it('seeds all system accounts used by the ledger', function (string $key) {
    expect(DB::table('accounts')->where('system_key', $key)->where('is_system', true)->exists())->toBeTrue();
})->with([
    'cash', 'cheques_in_hand', 'pawn_loans_receivable', 'forfeited_stock', 'stamp_duty_payable',
    'interest_income', 'service_charge_income', 'postage_income', 'document_charge_income',
    'rounding', 'sales_income', 'discount_allowed', 'cost_of_sales',
]);

it('gives every account the normal balance of its type', function () {
    $wrong = DB::table('accounts')->where(fn ($q) => $q
        ->where(fn ($q) => $q->whereIn('type', ['asset', 'expense'])->where('normal_balance', '!=', 'debit'))
        ->orWhere(fn ($q) => $q->whereIn('type', ['liability', 'equity', 'income'])->where('normal_balance', '!=', 'credit'))
    )->count();

    expect($wrong)->toBe(0);
});

it('seeds a document sequence for every type in every branch', function () {
    expect(DB::table('document_sequences')->count())
        ->toBe(2 * count(DocumentSequenceSeeder::TYPES));
});
