<?php

namespace App\Domain\Pawning\Calculation;

use App\Domain\Core\Support\Money;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * What a ticket owes on a date. Ported from the old
 * ReceiptFinancialCalculator::calculate().
 *
 *   interest        = max(0, gross − interest already paid this cycle + carried interest)
 *   arrears_total   = interest + service charge + letter postage   (no capital)
 *   redemption_total= capital + arrears_total
 *
 * The interest terms are the ticket's frozen terms. The service charge and
 * letter postage are passed in already resolved (service charge from the
 * scheme version in force on the date; postage from the letters actually
 * issued in the current cycle).
 */
final class TicketStatement
{
    /**
     * @param  array<int, string>  $letterCharges  letter_no => postage charged
     */
    public function __construct(
        public readonly string $calculationDate,
        public readonly int $days,
        public readonly string $principal,
        public readonly string $grossInterest,
        public readonly string $paidInterest,
        public readonly string $carriedInterest,
        public readonly string $interest,
        public readonly string $serviceCharge,
        public readonly array $letterCharges,
        public readonly string $letterCharge,
        public readonly string $arrearsTotal,
        public readonly string $redemptionTotal,
    ) {}

    /**
     * @param  array<int, string|int|float>  $letterCharges
     */
    public static function calculate(
        string|int|float $principal,
        CarbonInterface|string $cycleStart,
        CarbonInterface|string $asOf,
        InterestTerms $terms,
        string|int|float $interestPaidThisCycle = 0,
        string|int|float $carriedInterest = 0,
        string|int|float $serviceCharge = 0,
        array $letterCharges = [],
    ): self {
        $asOf = CarbonImmutable::parse($asOf)->startOfDay();
        $days = InterestCalculator::days($cycleStart, $asOf);
        $gross = InterestCalculator::gross($principal, $days, $terms);
        $interest = Money::of(Dec::pos(Dec::add(Dec::sub($gross, $interestPaidThisCycle), $carriedInterest)));

        $letters = [1 => '0.00', 2 => '0.00', 3 => '0.00'];
        foreach ($letterCharges as $no => $amount) {
            $letters[(int) $no] = Money::of($amount);
        }
        $letterTotal = Money::add(...array_values($letters));
        $service = Money::of($serviceCharge);
        $arrears = Money::add($interest, $service, $letterTotal);

        return new self(
            calculationDate: $asOf->toDateString(),
            days: $days,
            principal: Money::of($principal),
            grossInterest: $gross,
            paidInterest: Money::of($interestPaidThisCycle),
            carriedInterest: Money::of($carriedInterest),
            interest: $interest,
            serviceCharge: $service,
            letterCharges: $letters,
            letterCharge: $letterTotal,
            arrearsTotal: $arrears,
            redemptionTotal: Money::add($principal, $arrears),
        );
    }

    public function toArray(): array
    {
        return [
            'calculation_date' => $this->calculationDate,
            'days' => $this->days,
            'principal' => $this->principal,
            'gross_interest' => $this->grossInterest,
            'paid_interest' => $this->paidInterest,
            'carried_interest' => $this->carriedInterest,
            'interest' => $this->interest,
            'service_charge' => $this->serviceCharge,
            'letter_charges' => $this->letterCharges,
            'letter_charge' => $this->letterCharge,
            'arrears_total' => $this->arrearsTotal,
            'redemption_total' => $this->redemptionTotal,
        ];
    }
}
