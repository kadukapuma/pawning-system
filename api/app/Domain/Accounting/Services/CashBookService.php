<?php

namespace App\Domain\Accounting\Services;

use App\Domain\Accounting\Models\Account;
use App\Domain\Accounting\Models\DayClosing;
use App\Domain\Core\Support\Money;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Daily cash book = the branch's lines on the system "cash" account.
 * Day closing freezes the day: totals, counted cash and the variance.
 */
class CashBookService
{
    public function __construct(private AccountBalances $balances) {}

    public function cashAccountId(): int
    {
        return Account::system('cash')->id;
    }

    public function day(int $branchId, string $date): array
    {
        $cash = $this->cashAccountId();
        $opening = $this->balances->balance($cash, $branchId, CarbonImmutable::parse($date)->subDay()->toDateString());

        $lines = DB::table('journal_lines as l')
            ->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->leftJoin('users as u', 'u.id', '=', 'e.created_by')
            ->where('l.account_id', $cash)->where('l.branch_id', $branchId)->whereDate('l.entry_date', $date)
            ->orderBy('e.posted_at')->orderBy('l.id')
            ->get(['l.id', 'e.entry_no', 'e.narration', 'e.source_type', 'e.source_id', 'e.posted_at', 'l.description', 'l.debit', 'l.credit', 'u.name as user']);

        $running = $opening;
        $in = $out = '0.00';
        $rows = $lines->map(function ($l) use (&$running, &$in, &$out) {
            $running = Money::add($running, Money::sub($l->debit, $l->credit));
            $in = Money::add($in, $l->debit);
            $out = Money::add($out, $l->credit);

            return [
                'entry_no' => $l->entry_no, 'narration' => $l->narration, 'description' => $l->description,
                'source_type' => $l->source_type, 'source_id' => $l->source_id, 'time' => $l->posted_at, 'user' => $l->user,
                'cash_in' => Money::of($l->debit), 'cash_out' => Money::of($l->credit), 'balance' => $running,
            ];
        });

        $closing = DayClosing::withoutBranchScope()->with('closer:id,name')->where('branch_id', $branchId)->whereDate('business_date', $date)->first();

        return [
            'date' => $date,
            'opening' => $opening,
            'total_in' => $in,
            'total_out' => $out,
            'closing' => Money::add($opening, Money::sub($in, $out)),
            'lines' => $rows,
            'day_closing' => $closing,
        ];
    }

    public function close(int $branchId, string $date, string $physicalCash, ?string $notes = null): DayClosing
    {
        if (CarbonImmutable::parse($date)->isFuture()) {
            throw ValidationException::withMessages(['date' => 'You cannot close a future day.']);
        }

        return DB::transaction(function () use ($branchId, $date, $physicalCash) {
            $existing = DayClosing::withoutBranchScope()->lockForUpdate()->where('branch_id', $branchId)->whereDate('business_date', $date)->first();
            if ($existing?->status === 'closed') {
                throw ValidationException::withMessages(['date' => "{$date} is already closed."]);
            }

            $d = $this->day($branchId, $date);
            $values = [
                'opening_cash' => $d['opening'],
                'total_in' => $d['total_in'],
                'total_out' => $d['total_out'],
                'closing_cash' => $d['closing'],
                'physical_cash' => Money::of($physicalCash),
                'variance' => Money::sub($physicalCash, $d['closing']),
                'status' => 'closed',
                'closed_by' => auth()->id(),
                'closed_at' => now(),
            ];

            return $existing
                ? tap($existing)->update($values)
                : DayClosing::withoutBranchScope()->create($values + ['branch_id' => $branchId, 'business_date' => $date]);
        });
    }

    /** Re-open a closed day (e.g. a late correction). Recorded in the audit log by the caller. */
    public function reopen(int $branchId, string $date): DayClosing
    {
        $closing = DayClosing::withoutBranchScope()->where('branch_id', $branchId)->whereDate('business_date', $date)->where('status', 'closed')->firstOrFail();
        $closing->update(['status' => 'open']);

        return $closing;
    }
}
