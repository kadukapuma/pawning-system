<?php

namespace App\Domain\Masters\Services;

use App\Domain\Masters\Models\PawnScheme;
use App\Domain\Masters\Models\PawnSchemeVersion;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Scheme terms are versioned: an edit closes the open version and inserts a
 * new one. Issued tickets keep pointing at the version they were issued under.
 */
class SchemeVersionService
{
    /**
     * @param  array<string, mixed>  $terms  keys from PawnSchemeVersion::TERMS
     */
    public function createVersion(PawnScheme $scheme, array $terms, ?string $effectiveFrom = null): PawnSchemeVersion
    {
        $from = CarbonImmutable::parse($effectiveFrom ?? today())->startOfDay();

        if ($from->greaterThan(today())) {
            throw ValidationException::withMessages([
                'effective_from' => 'Future-dated scheme changes are not allowed. Make the change on the day it applies.',
            ]);
        }

        return DB::transaction(function () use ($scheme, $terms, $from) {
            $current = PawnSchemeVersion::query()
                ->where('scheme_id', $scheme->id)
                ->whereNull('effective_to')
                ->lockForUpdate()
                ->orderByDesc('effective_from')->orderByDesc('id')
                ->first();

            if ($current && $from->lessThan($current->effective_from)) {
                throw ValidationException::withMessages([
                    'effective_from' => 'Effective date cannot be before the current version ('.$current->effective_from->toDateString().').',
                ]);
            }

            $terms = array_intersect_key($terms, array_flip(PawnSchemeVersion::TERMS));
            $this->assertTermsAreSane($terms);
            $this->assertNoBandOverlap($scheme, $terms);

            if ($current) {
                // Same-day edits: the newer row wins (resolution orders by id desc).
                $closeOn = $from->subDay()->lessThan($current->effective_from) ? $current->effective_from : $from->subDay();
                $current->forceFill(['effective_to' => $closeOn->toDateString()])->save();
            }

            return PawnSchemeVersion::create($terms + [
                'scheme_id' => $scheme->id,
                'effective_from' => $from->toDateString(),
                'effective_to' => null,
                'created_by' => auth()->id(),
            ]);
        });
    }

    /** Version that applies to a date (latest effective, newest id first). */
    public function versionOn(PawnScheme $scheme, string $date): ?PawnSchemeVersion
    {
        return PawnSchemeVersion::query()->where('scheme_id', $scheme->id)->effectiveOn($date)->first();
    }

    private function assertTermsAreSane(array $t): void
    {
        $errors = [];
        if (isset($t['max_amount']) && $t['max_amount'] !== null && (float) $t['max_amount'] < (float) ($t['min_amount'] ?? 0)) {
            $errors['max_amount'] = 'Maximum amount must be greater than the minimum amount.';
        }
        if (($t['period1_days'] ?? 0) > ($t['period2_days'] ?? 0) || ($t['period2_days'] ?? 0) > ($t['period3_days'] ?? 0)) {
            $errors['period2_days'] = 'Interest periods must increase: period 1 ≤ period 2 ≤ period 3.';
        }
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }
    }

    /** Gold schemes are chosen by loan amount, so their open bands must not overlap. */
    private function assertNoBandOverlap(PawnScheme $scheme, array $terms): void
    {
        if ($scheme->interest_method === PawnScheme::METHOD_SILVER || ! $scheme->is_active) {
            return;
        }

        $min = (float) ($terms['min_amount'] ?? 0);
        $max = isset($terms['max_amount']) && $terms['max_amount'] !== null ? (float) $terms['max_amount'] : INF;

        $others = PawnSchemeVersion::query()
            ->join('pawn_schemes as s', 's.id', '=', 'pawn_scheme_versions.scheme_id')
            ->where('s.metal', $scheme->metal)
            ->where('s.is_active', true)
            ->where('s.interest_method', '!=', PawnScheme::METHOD_SILVER)
            ->where('s.id', '!=', $scheme->id)
            ->whereNull('pawn_scheme_versions.effective_to')
            ->get(['s.code', 'pawn_scheme_versions.min_amount', 'pawn_scheme_versions.max_amount']);

        foreach ($others as $o) {
            $oMax = $o->max_amount === null ? INF : (float) $o->max_amount;
            if ($min <= $oMax && (float) $o->min_amount <= $max) {
                throw ValidationException::withMessages([
                    'min_amount' => "Amount band overlaps scheme {$o->code} (".number_format((float) $o->min_amount, 2).' – '
                        .($o->max_amount === null ? 'no limit' : number_format((float) $o->max_amount, 2)).').',
                ]);
            }
        }
    }
}
