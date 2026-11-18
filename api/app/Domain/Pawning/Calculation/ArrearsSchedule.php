<?php

namespace App\Domain\Pawning\Calculation;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Arrears letters and the forfeit reminder (old ReceiptPenaltySchedule and
 * ArrearsLetterService).
 *
 * - Letter 1 is due on the expiry (maturity) date.
 * - Letter N (2, 3) is due letter_N_days after letter N−1 was ACTUALLY printed
 *   (a late print pushes later letters back).
 * - Letters go in order, once per cycle; a letter printed before the current
 *   expiry (an old cycle) cannot advance the schedule.
 * - The forfeit reminder is due forfeit_reminder_days after letter 3 was
 *   printed, provided the ticket has expired and no part payment / renewal
 *   happened after letter 3.
 *
 * All inputs are plain dates so the rules are testable without a database.
 */
final class ArrearsSchedule
{
    /**
     * @param  array{1?: ?string, 2?: ?string, 3?: ?string}  $printed  letter_no => print date in this cycle
     * @param  array{2: int, 3: int}  $intervals  letter_no => days after the previous print
     */
    public static function dueDate(int $letter, CarbonInterface|string $expiry, array $printed, array $intervals): ?CarbonImmutable
    {
        if ($letter < 1 || $letter > 3) {
            throw new \InvalidArgumentException('Letter number must be 1, 2 or 3.');
        }
        if ($letter === 1) {
            return CarbonImmutable::parse($expiry)->startOfDay();
        }

        $previous = $printed[$letter - 1] ?? null;

        return $previous
            ? CarbonImmutable::parse($previous)->startOfDay()->addDays($intervals[$letter] ?? 21)
            : null;
    }

    /** Can letter $letter be printed on $today? */
    public static function isEligible(
        int $letter,
        CarbonInterface|string $expiry,
        array $printed,
        array $intervals,
        CarbonInterface|string $today,
    ): bool {
        $today = CarbonImmutable::parse($today)->startOfDay();
        $expiry = CarbonImmutable::parse($expiry)->startOfDay();
        $due = self::dueDate($letter, $expiry, $printed, $intervals);

        if ($due === null || $today->lessThan($due)) {
            return false;
        }

        // Sequence: previous letter printed (in this cycle, on/after expiry), this and later not yet.
        for ($n = $letter; $n <= 3; $n++) {
            if (! empty($printed[$n])) {
                return false;
            }
        }
        if ($letter > 1) {
            $prev = $printed[$letter - 1] ?? null;
            if (! $prev || CarbonImmutable::parse($prev)->startOfDay()->lessThan($expiry)) {
                return false;
            }
        }

        return true;
    }

    public static function reminderDueDate(?string $letter3PrintedAt, int $reminderDays): ?CarbonImmutable
    {
        return $letter3PrintedAt
            ? CarbonImmutable::parse($letter3PrintedAt)->startOfDay()->addDays($reminderDays)
            : null;
    }

    public static function reminderIsDue(
        ?string $letter3PrintedAt,
        int $reminderDays,
        CarbonInterface|string $expiry,
        CarbonInterface|string $cycleStart,
        ?string $lastPaymentOrRenewalDate,
        CarbonInterface|string $today,
    ): bool {
        $due = self::reminderDueDate($letter3PrintedAt, $reminderDays);
        if ($due === null) {
            return false;
        }
        $today = CarbonImmutable::parse($today)->startOfDay();
        $letter3 = CarbonImmutable::parse($letter3PrintedAt)->startOfDay();

        if ($letter3->lessThan(CarbonImmutable::parse($cycleStart)->startOfDay())) {
            return false;                                     // letter from an older cycle
        }
        if (CarbonImmutable::parse($expiry)->startOfDay()->greaterThan($today) || $due->greaterThan($today)) {
            return false;
        }
        if ($lastPaymentOrRenewalDate && CarbonImmutable::parse($lastPaymentOrRenewalDate)->startOfDay()->greaterThan($letter3)) {
            return false;                                     // customer paid after letter 3
        }

        return true;
    }
}
