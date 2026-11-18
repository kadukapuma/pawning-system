<?php

namespace App\Domain\Pawning\Calculation;

/**
 * Article valuation and the loan-term table.
 *
 * Karat rates are per 8 g (one sovereign), so an article is worth
 * (rate ÷ 8) × net weight. Ported from pawnReceipt.blade.php and
 * RepawningCalculator (sampath-old).
 */
final class Valuation
{
    public const GRAMS_PER_RATE_UNIT = 8;

    /** Value of one article (money string). */
    public static function articleValue(string|int|float $ratePer8g, string|int|float $netWeight): string
    {
        return Dec::money(Dec::mul(Dec::div($ratePer8g, self::GRAMS_PER_RATE_UNIT), $netWeight));
    }

    /**
     * Maximum loan for each term length. Every extra month reduces the loan by
     * one month's interest on the article value, so the article still covers
     * capital + interest at maturity:
     *
     *   capacity(m) = value − (value × monthlyRate%) × (m − 1)
     *
     * @return array<int, string> month => maximum loan (months 1..$maxMonths)
     */
    public static function termCapacities(string|int|float $totalValue, string|int|float $monthlyRate, int $maxMonths = 12): array
    {
        $monthlyInterest = Dec::pct($totalValue, $monthlyRate);
        $out = [];
        for ($m = 1; $m <= max(1, $maxMonths); $m++) {
            $out[$m] = Dec::money(Dec::sub($totalValue, Dec::mul($monthlyInterest, $m - 1)));
        }

        return $out;
    }

    /**
     * Longest term whose capacity still covers the requested loan, or 0 when
     * the loan exceeds the article value.
     *
     * (The old screen picked the month whose capacity was *nearest* the loan,
     * which could pick a term the gold no longer covers. This picks the longest
     * term that is fully covered.)
     */
    public static function maxTermForLoan(string|int|float $loan, string|int|float $totalValue, string|int|float $monthlyRate, int $maxMonths = 12): int
    {
        $best = 0;
        foreach (self::termCapacities($totalValue, $monthlyRate, $maxMonths) as $m => $capacity) {
            if (Dec::cmp($capacity, $loan) >= 0) {
                $best = $m;
            }
        }

        return $best;
    }
}
