<?php

namespace App\Domain\Accounting\Services;

use InvalidArgumentException;

class UnbalancedJournalException extends InvalidArgumentException
{
    public function __construct(public readonly string $debits, public readonly string $credits)
    {
        parent::__construct("Journal is not balanced: debits {$debits} vs credits {$credits}.");
    }
}
