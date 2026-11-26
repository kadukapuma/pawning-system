<?php

namespace App\Domain\Sms\Services;

use App\Domain\Customers\Models\Customer;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Sms\Enums\SmsType;

/** A message that is due to someone, before its text is written. */
final class SmsCandidate
{
    /** @param  array<string, string|int|null>  $values  placeholder values */
    public function __construct(
        public readonly SmsType $type,
        public readonly ?string $key,
        public readonly Customer $customer,
        public readonly int $branchId,
        public readonly array $values,
        public readonly ?PawnTicket $ticket = null,
    ) {}
}
