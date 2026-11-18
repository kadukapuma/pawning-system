<?php

namespace App\Domain\Pawning\Calculation;

use App\Domain\Core\Support\Money;

/**
 * Renewal (old "repawning"). The articles are re-valued at today's karat
 * rates; everything owed (interest, service charge, letter postage, stamp
 * duty) is capitalised into the new principal, and the customer may take
 * extra cash up to what the gold still covers for the chosen term.
 * Ported from the old RepawningCalculator / RepawningController.
 */
final class RenewalCalculator
{
    /**
     * Month table shown to the cashier.
     *
     *   available(m) = articleValue − (principal + interest + service + letters + stamp)
     *                  − monthlyInterest × (m − 1)
     *   monthlyInterest = articleValue × monthlyRate%
     *
     * Months beyond $validMonths are null (not offered). Silver: 1 month only.
     *
     * @return array{article_value: string, total_due: string, available_amount: string,
     *               monthly_interest: string, valid_months: int, month_options: array<int, ?string>}
     */
    public static function preview(
        string|int|float $articleValue,
        string|int|float $principal,
        string|int|float $interest,
        string|int|float $serviceCharge,
        string|int|float $letterCharge,
        string|int|float $stampDuty,
        string|int|float $monthlyRate,
        int $validMonths,
    ): array {
        $totalDue = Dec::add($principal, $interest, $serviceCharge, $letterCharge, $stampDuty);
        $available = Dec::sub($articleValue, $totalDue);
        $monthlyInterest = Dec::pct($articleValue, $monthlyRate);
        $validMonths = min(12, max(0, $validMonths));

        $options = [];
        for ($m = 1; $m <= 12; $m++) {
            $options[$m] = $m <= $validMonths ? Money::of(Dec::sub($available, Dec::mul($monthlyInterest, $m - 1))) : null;
        }

        return [
            'article_value' => Money::of($articleValue),
            'total_due' => Money::of($totalDue),
            'available_amount' => Money::of($available),
            'monthly_interest' => Money::of($monthlyInterest),
            'valid_months' => $validMonths,
            'month_options' => $options,
        ];
    }

    /**
     * New principal after renewal:
     *   principal + extra cash + interest + service + letters + stamp − discount
     */
    public static function newPrincipal(
        string|int|float $principal,
        string|int|float $extraCash,
        string|int|float $interest,
        string|int|float $serviceCharge,
        string|int|float $letterCharge,
        string|int|float $stampDuty,
        string|int|float $discount = 0,
    ): string {
        return Money::of(Dec::pos(Dec::sub(
            Dec::add($principal, $extraCash, $interest, $serviceCharge, $letterCharge, $stampDuty),
            $discount,
        )));
    }
}
