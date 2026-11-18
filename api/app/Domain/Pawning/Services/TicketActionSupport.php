<?php

namespace App\Domain\Pawning\Services;

use App\Domain\Accounting\Services\JournalLineData;
use App\Domain\Accounting\Services\LedgerPoster;
use App\Domain\Core\Services\SequenceService;
use App\Domain\Core\Support\Money;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Models\PawnTransaction;
use Illuminate\Validation\ValidationException;

/** Shared plumbing for part payment / renewal / redemption. */
abstract class TicketActionSupport
{
    public function __construct(
        protected TicketCalculator $calculator,
        protected SequenceService $sequences,
        protected LedgerPoster $ledger,
    ) {}

    /** Lock the ticket row (in the working branch) and check it can take this action. */
    protected function lock(int $ticketId, bool $allowBlocked): PawnTicket
    {
        $ticket = PawnTicket::with(['scheme', 'schemeVersion', 'customer'])->lockForUpdate()->findOrFail($ticketId);
        $this->assertOpen($ticket, $allowBlocked);

        return $ticket;
    }

    protected function assertOpen(PawnTicket $ticket, bool $allowBlocked): void
    {
        if (! $ticket->isActive()) {
            throw ValidationException::withMessages(['ticket' => "Ticket {$ticket->receipt_no} is {$ticket->status}."]);
        }
        if ($ticket->is_blocked && ! $allowBlocked) {
            throw ValidationException::withMessages(['ticket' => "Ticket {$ticket->receipt_no} is blocked: {$ticket->block_reason}"]);
        }
    }

    protected function assertDiscountAllowed(string $discount): void
    {
        if (Money::isPositive($discount) && ! auth()->user()?->can('pawn.discount')) {
            throw ValidationException::withMessages(['discount' => 'You are not allowed to give discounts.']);
        }
    }

    protected function newTransaction(PawnTicket $ticket, string $type, array $values): PawnTransaction
    {
        return PawnTransaction::create($values + [
            'branch_id' => $ticket->branch_id,
            'pawn_ticket_id' => $ticket->id,
            'txn_no' => $this->sequences->next(PawnTransaction::SEQUENCE[$type], $ticket->branch_id),
            'type' => $type,
            'txn_at' => now(),
            'business_date' => today(),
            'created_by' => auth()->id(),
        ]);
    }

    /** @param list<JournalLineData> $lines */
    protected function post(PawnTransaction $txn, PawnTicket $ticket, array $lines, string $narration): void
    {
        $journal = $this->ledger->post($lines, $narration, $txn->business_date, $txn, $ticket->branch_id);
        $txn->update(['journal_entry_id' => $journal->id]);
    }

    /** Helpers so journal lines always carry the ticket and customer. */
    protected function dr(PawnTicket $t, string $account, string $amount, string $desc): JournalLineData
    {
        return JournalLineData::debit($account, $amount, $desc, $t->id, $t->customer_id);
    }

    protected function cr(PawnTicket $t, string $account, string $amount, string $desc): JournalLineData
    {
        return JournalLineData::credit($account, $amount, $desc, $t->id, $t->customer_id);
    }
}
