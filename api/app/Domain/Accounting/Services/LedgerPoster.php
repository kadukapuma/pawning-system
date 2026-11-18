<?php

namespace App\Domain\Accounting\Services;

use App\Domain\Accounting\Models\Account;
use App\Domain\Accounting\Models\JournalEntry;
use App\Domain\Core\Services\SequenceService;
use App\Domain\Core\Support\BranchContext;
use App\Domain\Core\Support\Money;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * The only way money reaches the ledger. Every entry is balanced
 * (sum of debits = sum of credits) and gets a branch journal number.
 */
class LedgerPoster
{
    public function __construct(
        private SequenceService $sequences,
        private BranchContext $context,
    ) {}

    /**
     * @param  list<JournalLineData>  $lines  zero-amount lines are dropped
     */
    public function post(
        array $lines,
        string $narration,
        CarbonInterface|string|null $date = null,
        ?Model $source = null,
        ?int $branchId = null,
    ): JournalEntry {
        $branchId ??= $this->context->requireId();
        $date = $date === null ? now()->toDateString() : (is_string($date) ? $date : $date->toDateString());

        $lines = array_values(array_filter($lines, fn (JournalLineData $l) => ! $l->isZero()));
        $this->assertValid($lines);

        return DB::transaction(function () use ($lines, $narration, $date, $source, $branchId) {
            $accounts = $this->resolveAccounts($lines);

            $entry = JournalEntry::withoutBranchScope()->create([
                'branch_id' => $branchId,
                'entry_no' => $this->sequences->next('journal', $branchId),
                'entry_date' => $date,
                'source_type' => $source?->getMorphClass(),
                'source_id' => $source?->getKey(),
                'narration' => mb_substr($narration, 0, 255),
                'status' => JournalEntry::STATUS_POSTED,
                'posted_by' => auth()->id(),
                'posted_at' => now(),
                'created_by' => auth()->id(),
            ]);

            foreach ($lines as $line) {
                $entry->lines()->create([
                    'account_id' => $accounts[$line->account]->id,
                    'branch_id' => $branchId,
                    'entry_date' => $date,
                    'debit' => $line->debit,
                    'credit' => $line->credit,
                    'description' => $line->description,
                    'pawn_ticket_id' => $line->pawnTicketId,
                    'customer_id' => $line->customerId,
                ]);
            }

            return $entry->load('lines');
        });
    }

    /** Post the mirror image of an entry and mark the original reversed. */
    public function reverse(JournalEntry $entry, string $reason, CarbonInterface|string|null $date = null): JournalEntry
    {
        return DB::transaction(function () use ($entry, $reason, $date) {
            $entry = JournalEntry::withoutBranchScope()->lockForUpdate()->findOrFail($entry->id);
            if ($entry->status !== JournalEntry::STATUS_POSTED) {
                throw new InvalidArgumentException("Journal {$entry->entry_no} is already reversed.");
            }

            $lines = $entry->lines->map(fn ($l) => JournalLineData::debit(
                $l->account_id, $l->credit, $l->description, $l->pawn_ticket_id, $l->customer_id,
            ))->merge($entry->lines->map(fn ($l) => JournalLineData::credit(
                $l->account_id, $l->debit, $l->description, $l->pawn_ticket_id, $l->customer_id,
            )))->all();

            $reversal = $this->post(
                $lines,
                "Reversal of {$entry->entry_no}: {$reason}",
                $date,
                $entry->source_type ? $entry->source : null,
                $entry->branch_id,
            );
            $reversal->update(['reversal_of_id' => $entry->id]);
            $entry->update(['status' => JournalEntry::STATUS_REVERSED]);

            return $reversal;
        });
    }

    /** @param list<JournalLineData> $lines */
    private function assertValid(array $lines): void
    {
        if (count($lines) < 2) {
            throw new InvalidArgumentException('A journal entry needs at least two non-zero lines.');
        }

        $debits = '0.00';
        $credits = '0.00';
        foreach ($lines as $line) {
            if (Money::isNegative($line->debit) || Money::isNegative($line->credit)) {
                throw new InvalidArgumentException('Journal amounts cannot be negative.');
            }
            if (Money::isPositive($line->debit) && Money::isPositive($line->credit)) {
                throw new InvalidArgumentException('A journal line is either a debit or a credit, not both.');
            }
            $debits = Money::add($debits, $line->debit);
            $credits = Money::add($credits, $line->credit);
        }

        if (Money::compare($debits, $credits) !== 0) {
            throw new UnbalancedJournalException($debits, $credits);
        }
    }

    /**
     * @param  list<JournalLineData>  $lines
     * @return array<string|int, Account>
     */
    private function resolveAccounts(array $lines): array
    {
        $resolved = [];
        foreach ($lines as $line) {
            if (isset($resolved[$line->account])) {
                continue;
            }
            $account = is_int($line->account)
                ? Account::find($line->account)
                : Account::system($line->account);

            if ($account === null || ! $account->is_active) {
                throw new InvalidArgumentException("Account [{$line->account}] does not exist or is inactive.");
            }
            $resolved[$line->account] = $account;
        }

        return $resolved;
    }
}
