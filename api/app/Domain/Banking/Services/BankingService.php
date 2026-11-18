<?php

namespace App\Domain\Banking\Services;

use App\Domain\Accounting\Models\Account;
use App\Domain\Accounting\Models\AccountGroup;
use App\Domain\Accounting\Models\JournalEntry;
use App\Domain\Accounting\Services\AccountBalances;
use App\Domain\Accounting\Services\JournalLineData;
use App\Domain\Accounting\Services\LedgerPoster;
use App\Domain\Banking\Models\BankAccount;
use App\Domain\Banking\Models\BankReconciliation;
use App\Domain\Banking\Models\BankReconciliationLine;
use App\Domain\Banking\Models\Cheque;
use App\Domain\Core\Support\BranchContext;
use App\Domain\Core\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Bank accounts, cash ⇄ bank transfers, cheques and bank reconciliation.
 *
 * Cheques received:  record  Dr cheques in hand / Cr counter account
 *                    deposit Dr bank            / Cr cheques in hand
 *                    return  Dr counter account / Cr cheques in hand (or bank, if deposited)
 * Cheques issued:    issue   Dr counter account / Cr bank
 *                    cancel  Dr bank            / Cr counter account
 */
class BankingService
{
    public function __construct(
        private LedgerPoster $ledger,
        private BranchContext $branch,
        private AccountBalances $balances,
    ) {}

    // ---------------------------------------------------------------- bank accounts

    public function createBankAccount(array $d): BankAccount
    {
        return DB::transaction(function () use ($d) {
            $group = AccountGroup::where('code', '1100')->firstOrFail();
            $next = (int) Account::whereBetween('code', ['1200', '1299'])->max('code') ?: 1199;

            $ledger = Account::create([
                'code' => (string) ($next + 1),
                'name' => 'Bank - '.$d['account_name'],
                'account_group_id' => $group->id,
                'type' => 'asset',
                'normal_balance' => 'debit',
                'branch_id' => $this->branch->requireId(),
                'is_bank' => true,
                'is_active' => true,
            ]);

            return BankAccount::create([
                'branch_id' => $this->branch->requireId(),
                'bank_branch_id' => $d['bank_branch_id'],
                'account_no' => $d['account_no'],
                'account_name' => $d['account_name'],
                'account_id' => $ledger->id,
                'is_active' => true,
            ]);
        });
    }

    /** Move money between two cash / bank ledger accounts (bank deposit, withdrawal). */
    public function transfer(int $fromAccountId, int $toAccountId, string $amount, string $date, ?string $narration): JournalEntry
    {
        $from = Account::findOrFail($fromAccountId);
        $to = Account::findOrFail($toAccountId);
        if ($from->id === $to->id || ! ($from->is_cash || $from->is_bank) || ! ($to->is_cash || $to->is_bank)) {
            throw ValidationException::withMessages(['to_account_id' => 'Choose two different cash / bank accounts.']);
        }
        if (! Money::isPositive($amount)) {
            throw ValidationException::withMessages(['amount' => 'Enter an amount above zero.']);
        }

        return $this->ledger->post([
            JournalLineData::debit($to->id, $amount, "From {$from->name}"),
            JournalLineData::credit($from->id, $amount, "To {$to->name}"),
        ], $narration ?: "Transfer {$from->name} → {$to->name}", $date);
    }

    // ---------------------------------------------------------------- cheques

    public function receiveCheque(array $d): Cheque
    {
        $counter = $this->counterAccount($d['counter_account_id']);

        return DB::transaction(function () use ($d, $counter) {
            $cheque = Cheque::create([
                'branch_id' => $this->branch->requireId(),
                'direction' => 'received',
                'cheque_no' => $d['cheque_no'],
                'bank_branch_id' => $d['bank_branch_id'] ?? null,
                'party_name' => $d['party_name'],
                'amount' => Money::of($d['amount']),
                'cheque_date' => $d['cheque_date'],
                'status' => 'in_hand',
                'source_type' => 'account',
                'source_id' => $counter->id,
                'created_by' => auth()->id(),
                'updated_by' => auth()->id(),
            ]);
            $j = $this->post($cheque, 'cheques_in_hand', $counter->id, "Cheque {$cheque->cheque_no} received from {$cheque->party_name}");
            $cheque->update(['journal_entry_id' => $j->id]);

            return $cheque;
        });
    }

    public function issueCheque(array $d): Cheque
    {
        $counter = $this->counterAccount($d['counter_account_id']);
        $bank = BankAccount::findOrFail($d['bank_account_id']);

        return DB::transaction(function () use ($d, $counter, $bank) {
            $cheque = Cheque::create([
                'branch_id' => $this->branch->requireId(),
                'direction' => 'issued',
                'cheque_no' => $d['cheque_no'],
                'bank_account_id' => $bank->id,
                'party_name' => $d['party_name'],
                'amount' => Money::of($d['amount']),
                'cheque_date' => $d['cheque_date'],
                'status' => 'issued',
                'source_type' => 'account',
                'source_id' => $counter->id,
                'created_by' => auth()->id(),
                'updated_by' => auth()->id(),
            ]);
            $j = $this->post($cheque, $counter->id, $bank->account_id, "Cheque {$cheque->cheque_no} issued to {$cheque->party_name}");
            $cheque->update(['journal_entry_id' => $j->id]);

            return $cheque;
        });
    }

    public function deposit(Cheque $cheque, int $bankAccountId): Cheque
    {
        return $this->transition($cheque, ['in_hand'], 'received', function (Cheque $c) use ($bankAccountId) {
            $bank = BankAccount::findOrFail($bankAccountId);
            $this->post($c, $bank->account_id, 'cheques_in_hand', "Cheque {$c->cheque_no} deposited");

            return ['status' => 'deposited', 'bank_account_id' => $bank->id, 'deposited_at' => now()];
        });
    }

    /** Bank confirmed the funds (received) or paid the cheque (issued). No ledger change. */
    public function clear(Cheque $cheque): Cheque
    {
        return $cheque->direction === 'received'
            ? $this->transition($cheque, ['deposited'], 'received', fn () => ['status' => 'cleared', 'cleared_at' => now()])
            : $this->transition($cheque, ['issued'], 'issued', fn () => ['status' => 'presented', 'cleared_at' => now()]);
    }

    /** A received cheque bounced: the amount is owed again by the counter account. */
    public function returnCheque(Cheque $cheque, string $reason): Cheque
    {
        return $this->transition($cheque, ['in_hand', 'deposited'], 'received', function (Cheque $c) use ($reason) {
            $credit = $c->status === 'deposited' ? $c->bankAccount->account_id : 'cheques_in_hand';
            $this->post($c, (int) $c->source_id, $credit, "Cheque {$c->cheque_no} returned: {$reason}");

            return ['status' => 'returned', 'returned_at' => now(), 'return_reason' => $reason];
        });
    }

    public function cancelIssued(Cheque $cheque, string $reason): Cheque
    {
        return $this->transition($cheque, ['issued'], 'issued', function (Cheque $c) use ($reason) {
            $this->post($c, $c->bankAccount->account_id, (int) $c->source_id, "Cheque {$c->cheque_no} cancelled: {$reason}");

            return ['status' => 'cancelled', 'return_reason' => $reason];
        });
    }

    private function transition(Cheque $cheque, array $from, string $direction, callable $do): Cheque
    {
        return DB::transaction(function () use ($cheque, $from, $direction, $do) {
            $c = Cheque::with('bankAccount')->lockForUpdate()->findOrFail($cheque->id);
            if ($c->direction !== $direction || ! in_array($c->status, $from, true)) {
                throw ValidationException::withMessages(['cheque' => "Cheque {$c->cheque_no} is {$c->status}; this action is not possible."]);
            }
            $c->update($do($c) + ['updated_by' => auth()->id()]);

            return $c;
        });
    }

    private function post(Cheque $c, int|string $debit, int|string $credit, string $narration): JournalEntry
    {
        return $this->ledger->post([
            JournalLineData::debit($debit, (string) $c->amount, $narration),
            JournalLineData::credit($credit, (string) $c->amount, $narration),
        ], $narration, today(), $c, $c->branch_id);
    }

    private function counterAccount(int $id): Account
    {
        $a = Account::findOrFail($id);
        if ($a->is_cash || $a->system_key === 'cheques_in_hand') {
            throw ValidationException::withMessages(['counter_account_id' => 'Choose the account the cheque is for (income, expense, payable...), not cash.']);
        }

        return $a;
    }

    // ---------------------------------------------------------------- reconciliation

    /** Ledger lines on the bank account up to the statement date that are not yet reconciled. */
    public function unreconciled(BankAccount $bank, string $statementDate, ?int $reconciliationId = null): array
    {
        $lines = DB::table('journal_lines as l')
            ->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->leftJoin('bank_reconciliation_lines as r', 'r.journal_line_id', '=', 'l.id')
            ->where('l.account_id', $bank->account_id)
            ->where('l.entry_date', '<=', $statementDate)
            ->where(fn ($q) => $q->whereNull('r.id')->when($reconciliationId, fn ($w) => $w->orWhere('r.reconciliation_id', $reconciliationId)))
            ->orderBy('l.entry_date')->orderBy('l.id')
            ->get(['l.id', 'l.entry_date', 'e.entry_no', 'e.narration', 'l.debit', 'l.credit', 'r.reconciliation_id']);

        return [
            'book_balance' => $this->balances->balance($bank->account_id, null, $statementDate),
            'cleared_before' => $this->clearedTotal($bank, $reconciliationId),
            'lines' => $lines,
        ];
    }

    private function clearedTotal(BankAccount $bank, ?int $exceptReconciliation): string
    {
        return Money::of(DB::table('bank_reconciliation_lines as r')
            ->join('bank_reconciliations as b', 'b.id', '=', 'r.reconciliation_id')
            ->join('journal_lines as l', 'l.id', '=', 'r.journal_line_id')
            ->where('b.bank_account_id', $bank->id)
            ->when($exceptReconciliation, fn ($q) => $q->where('b.id', '!=', $exceptReconciliation))
            ->selectRaw('COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS t')->value('t'));
    }

    /**
     * Save (or complete) a reconciliation: the ticked ledger lines are the ones
     * that appear on the bank statement. Completing requires
     * statement balance = everything cleared so far.
     */
    public function reconcile(BankAccount $bank, string $statementDate, string $statementBalance, array $lineIds, bool $complete): BankReconciliation
    {
        return DB::transaction(function () use ($bank, $statementDate, $statementBalance, $lineIds, $complete) {
            $rec = BankReconciliation::lockForUpdate()->firstOrNew(['bank_account_id' => $bank->id, 'statement_date' => $statementDate]);
            if ($rec->exists && $rec->status === 'completed') {
                throw ValidationException::withMessages(['statement_date' => 'This statement is already reconciled.']);
            }

            $valid = DB::table('journal_lines')->where('account_id', $bank->account_id)
                ->where('entry_date', '<=', $statementDate)->whereIn('id', $lineIds)->pluck('id');
            if ($valid->count() !== count(array_unique($lineIds))) {
                throw ValidationException::withMessages(['line_ids' => 'Some lines do not belong to this bank account or are after the statement date.']);
            }

            $rec->fill([
                'statement_balance' => Money::of($statementBalance),
                'book_balance' => $this->balances->balance($bank->account_id, null, $statementDate),
                'status' => 'draft',
                'reconciled_by' => auth()->id(),
            ])->save();

            $rec->lines()->delete();
            foreach ($valid as $id) {
                BankReconciliationLine::create(['reconciliation_id' => $rec->id, 'journal_line_id' => $id, 'cleared_date' => $statementDate]);
            }

            $cleared = Money::add($this->clearedTotal($bank, $rec->id), $this->clearedIn($rec));
            $difference = Money::sub($statementBalance, $cleared);
            if ($complete) {
                if (! Money::isZero($difference)) {
                    throw ValidationException::withMessages(['statement_balance' => 'Not balanced: statement differs from cleared items by Rs. '.number_format((float) $difference, 2).'.']);
                }
                $rec->update(['status' => 'completed', 'completed_at' => now()]);
            }

            return $rec->setAttribute('difference', $difference)->setAttribute('cleared_balance', $cleared);
        });
    }

    private function clearedIn(BankReconciliation $rec): string
    {
        return Money::of(DB::table('bank_reconciliation_lines as r')->join('journal_lines as l', 'l.id', '=', 'r.journal_line_id')
            ->where('r.reconciliation_id', $rec->id)->selectRaw('COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS t')->value('t'));
    }
}
