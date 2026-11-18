<?php

namespace App\Domain\Pawning\Calculation;

use App\Domain\Masters\Models\PawnScheme;
use App\Domain\Masters\Models\PawnSchemeVersion;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Validation\ValidationException;

/**
 * Picks the scheme version for a loan (old ReceiptTypeResolver):
 * - any Silver article → the Silver scheme;
 * - otherwise the active gold scheme whose amount band contains the loan.
 * Version = the one in force on the date (latest effective, newest id).
 */
class SchemeSelector
{
    public function forLoan(string|int|float $amount, bool $silver, CarbonInterface|string|null $date = null): PawnSchemeVersion
    {
        $date = CarbonImmutable::parse($date ?? today())->toDateString();

        $query = PawnSchemeVersion::query()
            ->with('scheme')
            ->join('pawn_schemes as s', 's.id', '=', 'pawn_scheme_versions.scheme_id')
            ->where('s.is_active', true)
            ->select('pawn_scheme_versions.*')
            ->effectiveOn($date);

        if ($silver) {
            $query->where('s.interest_method', PawnScheme::METHOD_SILVER);
        } else {
            $query->where('s.interest_method', '!=', PawnScheme::METHOD_SILVER)
                ->where('pawn_scheme_versions.min_amount', '<=', $amount)
                ->where(fn ($q) => $q->whereNull('pawn_scheme_versions.max_amount')
                    ->orWhere('pawn_scheme_versions.max_amount', '>=', $amount));
        }

        return $query->first() ?? throw ValidationException::withMessages([
            'amount' => $silver
                ? 'No active Silver scheme is configured.'
                : 'No active gold scheme covers a loan of Rs. '.number_format((float) $amount, 2).'.',
        ]);
    }

    /** Version of a given scheme in force on a date (for service charge / postage). */
    public function versionOn(int $schemeId, CarbonInterface|string $date): ?PawnSchemeVersion
    {
        return PawnSchemeVersion::query()
            ->where('scheme_id', $schemeId)
            ->effectiveOn(CarbonImmutable::parse($date)->toDateString())
            ->first();
    }
}
