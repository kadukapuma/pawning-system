<?php

namespace App\Domain\Pawning\Calculation;

use App\Domain\Core\Support\Money;
use Illuminate\Validation\ValidationException;

/**
 * Splits a part payment. Ported exactly from the old PartPaymentCalculator.
 *
 * - The discount comes off the interest first and reduces the cash received.
 * - Money pays interest and charges (letter postage) first, then capital.
 * - Interest the customer did not pay is capitalised (added to capital);
 *   unpaid charges are capitalised too — never carried as interest as well.
 * - Part payments take no service charge or stamp duty (only pawn, renewal
 *   and redemption do), so callers pass 0 for those.
 */
final class PartPaymentAllocation
{
    public function __construct(
        public readonly string $chargesDue,
        public readonly string $paymentReceived,
        public readonly string $redemptionTotal,
        public readonly string $paidCharges,
        public readonly string $paidInterest,
        public readonly string $principalPaid,
        public readonly string $newPrincipal,
        public readonly string $capitalisedInterest,
        public readonly string $capitalisedCharges,
    ) {}

    public static function calculate(
        string|int|float $principal,
        string|int|float $interest,
        string|int|float $serviceCharge,
        string|int|float $letterCharge,
        string|int|float $stampDuty,
        string|int|float $payment,
        string|int|float $discount = 0,
    ): self {
        $principal = Dec::pos($principal);
        $discount = Dec::pos($discount);

        $chargesDue = Dec::pos(Dec::sub(Dec::add($interest, $serviceCharge, $letterCharge, $stampDuty), $discount));
        $received = Dec::pos(Dec::sub($payment, $discount));
        $paidCharges = Dec::min($received, $chargesDue);
        $interestAfterDiscount = Dec::pos(Dec::sub($interest, Dec::min($interest, $discount)));
        $paidInterest = Dec::min($interestAfterDiscount, $paidCharges);
        $capInterest = Dec::pos(Dec::sub($interestAfterDiscount, $paidInterest));
        $capCharges = Dec::pos(Dec::sub(Dec::sub($chargesDue, $paidCharges), $capInterest));
        $principalPaid = Dec::min($principal, Dec::pos(Dec::sub($received, $chargesDue)));
        $newPrincipal = Dec::pos(Dec::add(Dec::sub($principal, $principalPaid), $capInterest, $capCharges));

        return new self(
            chargesDue: Money::of($chargesDue),
            paymentReceived: Money::of($received),
            redemptionTotal: Money::of(Dec::add($principal, $chargesDue)),
            paidCharges: Money::of($paidCharges),
            paidInterest: Money::of($paidInterest),
            principalPaid: Money::of($principalPaid),
            newPrincipal: Money::of($newPrincipal),
            capitalisedInterest: Money::of($capInterest),
            capitalisedCharges: Money::of($capCharges),
        );
    }

    /**
     * Business rules from the old controller: a payment that clears everything
     * must go through Redemption, and the remaining capital may not drop below
     * the scheme minimum (Rs. 1,000).
     */
    public function assertAllowed(string|int|float $minimumCapital = 1000): void
    {
        if (Money::compare(Money::add($this->paymentReceived, '0.01'), $this->redemptionTotal) >= 0) {
            throw ValidationException::withMessages([
                'amount' => 'This pays the full redemption amount. Use Redemption instead.',
            ]);
        }
        if (Money::isPositive($this->newPrincipal) && Money::compare($this->newPrincipal, $minimumCapital) < 0) {
            throw ValidationException::withMessages([
                'amount' => 'At least Rs. '.number_format((float) $minimumCapital, 2).' of capital must remain after a part payment.',
            ]);
        }
    }

    public function toArray(): array
    {
        return get_object_vars($this);
    }
}
