<?php

use App\Domain\Masters\Models\PawnScheme;
use App\Domain\Masters\Services\SchemeVersionService;
use App\Domain\Pawning\Calculation\InterestTerms;
use App\Domain\Pawning\Calculation\SchemeSelector;
use Illuminate\Validation\ValidationException;

it('picks the gold scheme by loan amount band', function ($amount, $code) {
    expect(app(SchemeSelector::class)->forLoan($amount, false)->scheme->code)->toBe($code);
})->with([
    [1000, 'A'], [49999.99, 'A'], [50000, 'B'], [99999.99, 'B'], [100000, 'C'], [2500000, 'C'],
]);

it('picks the silver scheme whenever an article is silver', function () {
    expect(app(SchemeSelector::class)->forLoan(150000, true)->scheme->code)->toBe('SILVER');
});

it('uses the newest version in force on the date', function () {
    $this->actingAs(userWithRole('head_office'));
    $a = PawnScheme::where('code', 'A')->first();
    $terms = $a->currentVersion->only(\App\Domain\Masters\Models\PawnSchemeVersion::TERMS);
    $new = app(SchemeVersionService::class)->createVersion($a, ['rate3' => 3] + $terms);

    $picked = app(SchemeSelector::class)->forLoan(20000, false);
    expect($picked->id)->toBe($new->id)
        ->and((float) $picked->rate3)->toBe(3.0)
        ->and(app(SchemeSelector::class)->forLoan(20000, false, '2026-06-01')->id)->not->toBe($new->id);
});

it('builds interest terms from a version', function () {
    $v = app(SchemeSelector::class)->forLoan(20000, false);
    $t = InterestTerms::fromVersion($v, $v->scheme->interest_method);

    expect($t->method)->toBe('tiered')->and($t->rate3)->toBe('2.5000')->and($t->monthlyRate())->toBe('2.5000');
});

it('fails clearly when no active scheme covers the amount', function () {
    PawnScheme::where('code', 'C')->update(['is_active' => false]);

    app(SchemeSelector::class)->forLoan(150000, false);
})->throws(ValidationException::class, 'No active gold scheme');
