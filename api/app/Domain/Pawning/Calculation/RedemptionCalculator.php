<?php

namespace App\Domain\Pawning\Calculation;

use App\Domain\Core\Support\Money;
use Illuminate\Validation\ValidationException;

/**
 * Redemption totals and cash rounding.
 *
 *   payable = capital + interest + service charge + letter postage + stamp duty − discount
 *
 * Same-day rule (old RedeemController): on or before the cycle start date no
 * new interest is due — only interest carried from an earlier cycle. That is
 * already what TicketStatement gives for days = 0.
 *
 * Cash rounding (old ReceiptHistoryService): when the cash taken differs from
 * the payable amount by less than Rs. 5, the difference is booked as a
 * rounding adjustment so the ticket closes at exactly 0.00.
 */
final class RedemptionCalculator
{
    public const ROUNDING_TOLERANCE = '5.00';

    /**
     * @return array{interest: string, service_charge: string, letter_charge: string, stamp_duty: string,
     *               discount: string, principal: string, payable: string}
     */
    public static function totals(TicketStatement $s, string|int|float $stampDuty = 0, string|int|float $discount = 0): array
    {
        $discount = Money::of($discount);
        $charges = Money::add($s->interest, $s->serviceCharge, $s->letterCharge, $stampDuty);
        if (Money::compare($discount, $charges) > 0) {
            throw ValidationException::withMessages(['discount' => 'Discount cannot be more than the interest and charges.']);
        }

        return [
            'principal' => $s->principal,
            'interest' => $s->interest,
            'service_charge' => $s->serviceCharge,
            'letter_charge' => $s->letterCharge,
            'stamp_duty' => Money::of($stampDuty),
            'discount' => $discount,
            'payable' => Money::sub(Money::add($s->principal, $charges), $discount),
        ];
    }

    /**
     * Rounding adjustment for cash taken (positive = customer paid more).
     * Null when the cash matches exactly. Throws when the gap is Rs. 5 or more.
     */
    public static function roundingAdjustment(string|int|float $payable, string|int|float $cashReceived): ?string
    {
        $diff = Money::sub($cashReceived, $payable);
        if (Money::isZero($diff)) {
            return null;
        }
        $abs = Money::isNegative($diff) ? Money::sub(0, $diff) : $diff;
        if (Money::compare($abs, self::ROUNDING_TOLERANCE) >= 0) {
            throw ValidationException::withMessages([
                'cash_received' => 'Cash received must equal the payable amount (Rs. '.number_format((float) $payable, 2)
                    .'), within Rs. '.self::ROUNDING_TOLERANCE.' for rounding.',
            ]);
        }

        return $diff;
    }
}
