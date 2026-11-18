<?php

namespace App\Domain\Accounting\Services;

use App\Domain\Accounting\Models\Account;
use App\Domain\Accounting\Models\Voucher;
use App\Domain\Core\Services\SequenceService;
use App\Domain\Core\Support\BranchContext;
use App\Domain\Core\Support\Money;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Vouchers: requested by one person, approved (and posted) by another.
 *   payment / expense / petty cash:  Dr account          Cr cash or bank
 *   receipt:                         Dr cash or bank     Cr account
 */
class VoucherService
{
    public function __construct(
        private SequenceService $sequences,
        private LedgerPoster $ledger,
        private BranchContext $branch,
    ) {}

    public function create(array $d): Voucher
    {
        $account = Account::findOrFail($d['account_id']);
        $cashAccount = Account::findOrFail($d['cash_account_id']);

        if (! $cashAccount->is_cash && ! $cashAccount->is_bank) {
            throw ValidationException::withMessages(['cash_account_id' => 'Pay from / into must be a cash or bank account.']);
        }
        if ($account->is_cash || $account->is_bank || $account->id === $cashAccount->id) {
            throw ValidationException::withMessages(['account_id' => 'Choose the expense / income account, not a cash or bank account. Use a bank transfer instead.']);
        }
        if (! $account->is_active || ! $cashAccount->is_active) {
            throw ValidationException::withMessages(['account_id' => 'Account is inactive.']);
        }
        if (CarbonImmutable::parse($d['voucher_date'])->isFuture()) {
            throw ValidationException::withMessages(['voucher_date' => 'Voucher date cannot be in the future.']);
        }

        $branchId = $this->branch->requireId();

        return DB::transaction(fn () => Voucher::create([
            'branch_id' => $branchId,
            'voucher_no' => $this->sequences->next('voucher_'.$d['type'], $branchId),
            'type' => $d['type'],
            'voucher_date' => $d['voucher_date'],
            'party_name' => $d['party_name'] ?? null,
            'account_id' => $account->id,
            'cash_account_id' => $cashAccount->id,
            'amount' => Money::of($d['amount']),
            'description' => $d['description'] ?? null,
            'requested_by' => auth()->id(),
        ]));
    }

    public function approve(Voucher $voucher): Voucher
    {
        return DB::transaction(function () use ($voucher) {
            $v = Voucher::lockForUpdate()->findOrFail($voucher->id);
            $this->assertPending($v);
            if ($v->requested_by === auth()->id()) {
                throw ValidationException::withMessages(['voucher' => 'You cannot approve a voucher you requested.']);
            }

            $desc = trim(($v->party_name ? $v->party_name.': ' : '').($v->description ?? ''));
            $lines = $v->isOutflow()
                ? [JournalLineData::debit($v->account_id, (string) $v->amount, $desc), JournalLineData::credit($v->cash_account_id, (string) $v->amount, $desc)]
                : [JournalLineData::debit($v->cash_account_id, (string) $v->amount, $desc), JournalLineData::credit($v->account_id, (string) $v->amount, $desc)];

            $journal = $this->ledger->post($lines, ucfirst(str_replace('_', ' ', $v->type))." voucher {$v->voucher_no}",
                $v->voucher_date->toDateString(), $v, $v->branch_id);

            $v->update([
                'status' => Voucher::POSTED,
                'approved_by' => auth()->id(),
                'approved_at' => now(),
                'journal_entry_id' => $journal->id,
            ]);

            return $v;
        });
    }

    public function reject(Voucher $voucher, string $reason): Voucher
    {
        return DB::transaction(function () use ($voucher, $reason) {
            $v = Voucher::lockForUpdate()->findOrFail($voucher->id);
            $this->assertPending($v);
            $v->update([
                'status' => Voucher::REJECTED,
                'approved_by' => auth()->id(),
                'approved_at' => now(),
                'rejection_reason' => $reason,
            ]);

            return $v;
        });
    }

    private function assertPending(Voucher $v): void
    {
        if ($v->status !== Voucher::PENDING) {
            throw ValidationException::withMessages(['voucher' => "Voucher {$v->voucher_no} is already {$v->status}."]);
        }
    }
}
