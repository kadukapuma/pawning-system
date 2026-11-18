<?php

namespace App\Domain\Pawning\Calculation;

use App\Domain\Masters\Models\PawnScheme;
use App\Domain\Masters\Models\PawnSchemeVersion;

/**
 * The interest terms frozen on a ticket (from the scheme version it was
 * issued or last renewed under).
 */
final class InterestTerms
{
    public function __construct(
        public readonly string $method,          // tiered | monthly_penalty | silver
        public readonly int $period1Days,
        public readonly string $rate1,
        public readonly int $period2Days,
        public readonly string $rate2,
        public readonly int $period3Days,        // length of an interest "month" (30)
        public readonly string $rate3,           // monthly rate after period 2
        public readonly int $validDays = 0,      // monthly_penalty: penalty starts after this; silver: expiry
        public readonly string $penaltyRateMonthly = '0',
    ) {}

    public static function fromVersion(PawnSchemeVersion $v, string $method): self
    {
        return new self(
            method: $method,
            period1Days: (int) $v->period1_days,
            rate1: (string) $v->rate1,
            period2Days: (int) $v->period2_days,
            rate2: (string) $v->rate2,
            period3Days: (int) ($v->period3_days ?: 30),
            rate3: (string) $v->rate3,
            validDays: (int) $v->valid_days,
            penaltyRateMonthly: (string) $v->penalty_rate_monthly,
        );
    }

    public function isSilver(): bool
    {
        return $this->method === PawnScheme::METHOD_SILVER;
    }

    /** Monthly rate used for term tables: rate1 for Silver, rate3 for gold. */
    public function monthlyRate(): string
    {
        return $this->isSilver() ? $this->rate1 : $this->rate3;
    }
}
