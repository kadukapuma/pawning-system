<?php

namespace App\Domain\Pawning\Services;

use App\Domain\Accounting\Models\JournalEntry;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Models\PawnTicketEvent;
use App\Domain\Pawning\Models\PawnTransaction;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Cancel (same day, no other activity) and block / unblock. */
class TicketAdminService extends TicketActionSupport
{
    /** Undo a pawn made in error today: reverses the cash journal, keeps the record. */
    public function cancel(int $ticketId, string $reason): PawnTicket
    {
        return DB::transaction(function () use ($ticketId, $reason) {
            $ticket = $this->lock($ticketId, true);

            if (! $ticket->created_at->isToday()) {
                throw ValidationException::withMessages(['ticket' => 'Only a ticket created today can be cancelled.']);
            }
            $txns = $ticket->transactions()->get();
            if ($txns->count() !== 1 || ! in_array($txns->first()->type, [PawnTransaction::PAWN, PawnTransaction::OPENING], true)) {
                throw ValidationException::withMessages(['ticket' => 'This ticket already has payments and cannot be cancelled.']);
            }
            if ($ticket->letters()->exists()) {
                throw ValidationException::withMessages(['ticket' => 'This ticket has arrears letters and cannot be cancelled.']);
            }

            $pawnTxn = $txns->first();
            $reversal = $this->ledger->reverse(JournalEntry::withoutBranchScope()->findOrFail($pawnTxn->journal_entry_id), $reason);

            $this->newTransaction($ticket, PawnTransaction::CANCELLATION, [
                'principal_before' => $ticket->principal_current,
                'principal_paid' => $ticket->principal_current,
                'principal_after' => 0,
                'cash_received' => $pawnTxn->cash_paid,
                'reversal_of_id' => $pawnTxn->id,
                'journal_entry_id' => $reversal->id,
                'remarks' => $reason,
            ]);

            $ticket->update([
                'status' => PawnTicket::STATUS_CANCELLED,
                'principal_current' => 0,
                'cancelled_at' => now(),
                'cancelled_by' => auth()->id(),
                'cancel_reason' => $reason,
                'updated_by' => auth()->id(),
            ]);
            $ticket->items()->update(['status' => 'returned']);
            PawnTicketEvent::record($ticket, 'cancelled', $reason);

            return $ticket->fresh();
        });
    }

    public function setBlocked(int $ticketId, bool $blocked, ?string $reason): PawnTicket
    {
        return DB::transaction(function () use ($ticketId, $blocked, $reason) {
            $ticket = $this->lock($ticketId, true);
            if ($ticket->is_blocked === $blocked) {
                throw ValidationException::withMessages(['ticket' => $blocked ? 'Ticket is already blocked.' : 'Ticket is not blocked.']);
            }

            $ticket->update($blocked
                ? ['is_blocked' => true, 'blocked_at' => now(), 'blocked_by' => auth()->id(), 'block_reason' => $reason]
                : ['is_blocked' => false, 'blocked_at' => null, 'blocked_by' => null, 'block_reason' => null]);
            PawnTicketEvent::record($ticket, $blocked ? 'blocked' : 'unblocked', $reason);

            return $ticket->fresh();
        });
    }
}
