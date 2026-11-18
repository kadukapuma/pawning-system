<?php

namespace App\Domain\Pawning\Calculation;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Cycle start and maturity dates.
 *
 * - New pawn / renewal: interest starts on the transaction day.
 * - Part payment: interest for the day is settled, so the new cycle starts the
 *   NEXT day (old PawningPartPaymentController: Pawn_Date = redeem_date + 1).
 * - Gold maturity = transaction date + term months.
 * - Silver maturity = transaction date + the scheme's valid days.
 */
final class CycleDates
{
    public static function maturity(CarbonInterface|string $from, int $months, bool $silver, int $silverValidDays): CarbonImmutable
    {
        $from = CarbonImmutable::parse($from)->startOfDay();

        return $silver
            ? $from->addDays($silverValidDays > 0 ? $silverValidDays : 30)
            : $from->addMonthsNoOverflow(max(1, $months));
    }

    public static function cycleStartAfterPartPayment(CarbonInterface|string $paymentDate): CarbonImmutable
    {
        return CarbonImmutable::parse($paymentDate)->startOfDay()->addDay();
    }
}
