<?php

use App\Domain\Masters\Models\Karat;
use App\Domain\Masters\Models\PawnScheme;
use App\Domain\Masters\Models\PawnSchemeVersion;
use Illuminate\Support\Facades\DB;

function schemeTerms(array $overrides = []): array
{
    $v = PawnScheme::where('code', 'A')->first()->currentVersion;

    return array_merge(collect(PawnSchemeVersion::TERMS)->mapWithKeys(fn ($k) => [$k => $v->{$k}])->all(), $overrides);
}

it('returns all dropdown lookups to any signed-in user', function () {
    $this->actingAs(userWithRole('valuer'))->withHeaders(spaHeaders())->getJson('/api/v1/lookups')
        ->assertOk()
        ->assertJsonCount(2, 'data.branches')
        ->assertJsonCount(16, 'data.karats')
        ->assertJsonCount(4, 'data.schemes')
        ->assertJsonCount(169, 'data.article_types')
        ->assertJsonPath('data.karats.0.current_rate.pawn_rate_per_8g', '340000.00');
});

it('updates only changed karat rates and keeps history', function () {
    $b4 = Karat::where('code', 'B4')->first();
    $a0 = Karat::where('code', 'A0')->with('currentRate')->first();
    $rate = fn ($k, $pawn) => [
        'karat_id' => $k->id, 'pawn_rate_per_8g' => $pawn, 'assess_rate_per_8g' => 340000,
        'market_rate_per_8g' => 325834, 'sale_rate_per_8g' => 370000,
    ];
    $unchanged = ['karat_id' => $a0->id] + collect($a0->currentRate->only([
        'pawn_rate_per_8g', 'assess_rate_per_8g', 'market_rate_per_8g', 'sale_rate_per_8g',
    ]))->all();

    $this->actingAs(userWithRole('head_office'))->withHeaders(spaHeaders())
        ->postJson('/api/v1/karat-rates', ['rates' => [$rate($b4, 345000), $unchanged]])
        ->assertOk()
        ->assertJsonPath('meta.changed', 1);

    expect(DB::table('karat_rates')->where('karat_id', $b4->id)->count())->toBe(2)
        ->and((float) $b4->fresh()->currentRate->pawn_rate_per_8g)->toBe(345000.0)
        ->and(DB::table('karat_rates')->where('karat_id', $a0->id)->count())->toBe(1);
});

it('forbids cashiers from changing karat rates', function () {
    $this->actingAs(userWithRole('cashier'))->withHeaders(spaHeaders())
        ->postJson('/api/v1/karat-rates', ['rates' => []])->assertForbidden();
});

it('versions scheme terms instead of editing them', function () {
    $scheme = PawnScheme::where('code', 'A')->first();
    $oldVersion = $scheme->currentVersion;

    $this->actingAs(userWithRole('head_office'))->withHeaders(spaHeaders())
        ->postJson("/api/v1/schemes/{$scheme->id}/versions", schemeTerms(['postage_charge' => 175]))
        ->assertCreated()
        ->assertJsonPath('data.postage_charge', '175.00');

    $oldVersion->refresh();
    expect((float) $oldVersion->postage_charge)->toBe(150.0)          // old terms untouched
        ->and($oldVersion->effective_to)->not->toBeNull()
        ->and(PawnSchemeVersion::where('scheme_id', $scheme->id)->count())->toBe(2)
        ->and((float) $scheme->fresh()->currentVersion->postage_charge)->toBe(175.0);
});

it('rejects future-dated scheme changes', function () {
    $scheme = PawnScheme::where('code', 'A')->first();

    $this->actingAs(userWithRole('head_office'))->withHeaders(spaHeaders())
        ->postJson("/api/v1/schemes/{$scheme->id}/versions", schemeTerms(['effective_from' => today()->addDay()->toDateString()]))
        ->assertStatus(422)->assertJsonValidationErrors('effective_from');
});

it('rejects a gold amount band that overlaps another scheme', function () {
    $scheme = PawnScheme::where('code', 'A')->first();

    $this->actingAs(userWithRole('head_office'))->withHeaders(spaHeaders())
        ->postJson("/api/v1/schemes/{$scheme->id}/versions", schemeTerms(['max_amount' => 60000]))
        ->assertStatus(422)
        ->assertJsonPath('errors.min_amount.0', fn ($m) => str_contains($m, 'overlaps scheme B'));
});

it('rejects decreasing interest periods', function () {
    $scheme = PawnScheme::where('code', 'A')->first();

    $this->actingAs(userWithRole('head_office'))->withHeaders(spaHeaders())
        ->postJson("/api/v1/schemes/{$scheme->id}/versions", schemeTerms(['period1_days' => 20, 'period2_days' => 15]))
        ->assertStatus(422)->assertJsonValidationErrors('period2_days');
});

it('manages categories, article types (auto code) and conditions', function () {
    $admin = userWithRole('head_office');
    $cat = $this->actingAs($admin)->withHeaders(spaHeaders())
        ->postJson('/api/v1/article-categories', ['name' => 'Nose Pin', 'metal' => 'gold'])
        ->assertCreated()->json('data.id');

    $this->actingAs($admin)->withHeaders(spaHeaders())
        ->postJson('/api/v1/article-types', ['category_id' => $cat, 'name' => 'Stone Nose Pin'])
        ->assertCreated()->assertJsonPath('data.code', 'ITM-0171');

    $this->actingAs($admin)->withHeaders(spaHeaders())
        ->postJson('/api/v1/article-types', ['category_id' => $cat, 'name' => 'Stone Nose Pin'])
        ->assertStatus(422)->assertJsonValidationErrors('name');

    $this->actingAs($admin)->withHeaders(spaHeaders())
        ->postJson('/api/v1/article-conditions', ['name' => 'Bent'])->assertCreated();

    $this->actingAs(userWithRole('cashier'))->withHeaders(spaHeaders())
        ->postJson('/api/v1/article-conditions', ['name' => 'Scratched'])->assertForbidden();
});

it('manages banks and their branches', function () {
    $admin = userWithRole('head_office');
    $bank = $this->actingAs($admin)->withHeaders(spaHeaders())
        ->postJson('/api/v1/banks', ['code' => '7083', 'name' => 'Hatton National Bank'])
        ->assertCreated()->json('data.id');

    $this->actingAs($admin)->withHeaders(spaHeaders())
        ->postJson("/api/v1/banks/{$bank}/branches", ['code' => '045', 'name' => 'Balangoda'])->assertCreated();

    $this->actingAs($admin)->withHeaders(spaHeaders())->getJson('/api/v1/banks')
        ->assertOk()->assertJsonPath('data.0.branches.0.name', 'Balangoda');
});
