<?php

namespace App\Domain\Pawning\Calculation;

use App\Domain\Masters\Models\PawnScheme;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Gross interest for a number of days. Ported from the old
 * ReceiptFinancialCalculator::interestForDays, SilverInterest and
 * ReceiptInterestPeriod (sampath-old/app/Services).
 */
final class InterestCalculator
{
    /**
     * Interest days are inclusive: the cycle start date is day 1. A date before
     * the cycle start (e.g. the day of a part payment — the new cycle starts the
     * next day) is 0 days.
     */
    public static function days(CarbonInterface|string $cycleStart, CarbonInterface|string $asOf): int
    {
        $start = CarbonImmutable::parse($cycleStart)->startOfDay();
        $end = CarbonImmutable::parse($asOf)->startOfDay();

        return max(0, (int) $start->diffInDays($end, false) + 1);
    }

    /** @return string money (2 dp) */
    public static function gross(string|int|float $principal, int $days, InterestTerms $t): string
    {
        if ($days <= 0 || Dec::cmp($principal, 0) <= 0) {
            return '0.00';
        }

        return Dec::money(match ($t->method) {
            PawnScheme::METHOD_SILVER => self::silver($principal, $days, $t),
            PawnScheme::METHOD_MONTHLY_PENALTY => self::monthlyPenalty($principal, $days, $t),
            default => self::tiered($principal, $days, $t),
        });
    }

    /**
     * Gold (A/B/C): flat rate1 up to period1, flat rate2 up to period2, flat
     * rate3 up to one month; after that rate3 per full month plus rate3/30 per
     * extra day.
     */
    private static function tiered(string|int|float $principal, int $days, InterestTerms $t): string
    {
        if ($days <= $t->period1Days) {
            return Dec::pct($principal, $t->rate1);
        }
        if ($days <= $t->period2Days) {
            return Dec::pct($principal, $t->rate2);
        }

        return self::monthlyThenDaily($principal, $days, $t->rate3, $t->period3Days);
    }

    /** Silver: one full period minimum, then daily proration at the same rate. */
    private static function silver(string|int|float $principal, int $days, InterestTerms $t): string
    {
        if (Dec::cmp($t->rate1, 0) <= 0) {
            return '0';
        }

        return self::monthlyThenDaily($principal, $days, $t->rate1, $t->period3Days);
    }

    /**
     * Old type "D": rate2 per started month, plus a penalty rate per started
     * month beyond the valid period.
     */
    private static function monthlyPenalty(string|int|float $principal, int $days, InterestTerms $t): string
    {
        $month = $t->period3Days > 0 ? $t->period3Days : 30;
        $base = Dec::mul(Dec::pct($principal, $t->rate2), (int) ceil($days / $month));

        if ($t->validDays > 0 && $days > $t->validDays) {
            $penaltyMonths = (int) ceil(($days - $t->validDays) / $month);

            return Dec::add($base, Dec::mul(Dec::pct($principal, $t->penaltyRateMonthly), $penaltyMonths));
        }

        return $base;
    }

    private static function monthlyThenDaily(string|int|float $principal, int $days, string $monthlyRate, int $monthDays): string
    {
        $monthDays = $monthDays > 0 ? $monthDays : 30;
        if ($days <= $monthDays) {
            return Dec::pct($principal, $monthlyRate);
        }

        $fullMonths = intdiv($days, $monthDays);
        $extraDays = $days % $monthDays;
        $rate = Dec::add(Dec::mul($monthlyRate, $fullMonths), Dec::mul(Dec::div($monthlyRate, $monthDays), $extraDays));

        return Dec::pct($principal, $rate);
    }
}
