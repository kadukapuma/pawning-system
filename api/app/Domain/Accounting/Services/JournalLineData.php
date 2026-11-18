<?php

namespace App\Domain\Accounting\Services;

use App\Domain\Core\Support\Money;

/**
 * One line handed to LedgerPoster. `account` is a system_key (e.g. "cash")
 * or an accounts.id.
 */
final class JournalLineData
{
    public readonly string $debit;

    public readonly string $credit;

    private function __construct(
        public readonly string|int $account,
        string $debit,
        string $credit,
        public readonly ?string $description = null,
        public readonly ?int $pawnTicketId = null,
        public readonly ?int $customerId = null,
    ) {
        $this->debit = Money::of($debit);
        $this->credit = Money::of($credit);
    }

    public static function debit(string|int $account, string|int|float $amount, ?string $description = null, ?int $pawnTicketId = null, ?int $customerId = null): self
    {
        return new self($account, (string) $amount, '0', $description, $pawnTicketId, $customerId);
    }

    public static function credit(string|int $account, string|int|float $amount, ?string $description = null, ?int $pawnTicketId = null, ?int $customerId = null): self
    {
        return new self($account, '0', (string) $amount, $description, $pawnTicketId, $customerId);
    }

    public function isZero(): bool
    {
        return Money::isZero($this->debit) && Money::isZero($this->credit);
    }

    /** Same line with debit and credit swapped (for reversals). */
    public function reversed(): self
    {
        return new self($this->account, $this->credit, $this->debit, $this->description, $this->pawnTicketId, $this->customerId);
    }
}
