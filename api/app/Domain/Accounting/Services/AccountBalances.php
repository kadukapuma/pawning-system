<?php

namespace App\Domain\Accounting\Services;

use App\Domain\Accounting\Models\Account;
use App\Domain\Core\Support\Money;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Balances and financial statements straight from journal_lines.
 * $branchId = null means all branches (and includes account opening balances,
 * which are company-wide).
 */
class AccountBalances
{
    private function lines(?int $branchId, ?string $from, ?string $to): Builder
    {
        return DB::table('journal_lines as l')
            ->when($branchId, fn ($q) => $q->where('l.branch_id', $branchId))
            ->when($from, fn ($q) => $q->where('l.entry_date', '>=', $from))
            ->when($to, fn ($q) => $q->where('l.entry_date', '<=', $to));
    }

    /** Debit − credit for one account. */
    public function balance(int $accountId, ?int $branchId = null, ?string $to = null, ?string $from = null): string
    {
        $v = $this->lines($branchId, $from, $to)->where('l.account_id', $accountId)
            ->selectRaw('COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS b')->value('b');

        return Money::of($v);
    }

    /** @return Collection<int, object{account_id:int, debit:string, credit:string}> */
    private function totals(?int $branchId, ?string $from, ?string $to): Collection
    {
        return $this->lines($branchId, $from, $to)
            ->groupBy('l.account_id')
            ->selectRaw('l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit')
            ->get()->keyBy('account_id');
    }

    private function accounts(): Collection
    {
        return Account::with('group:id,code,name')->orderBy('code')->get();
    }

    /** Signed opening balance (debit positive) for company-wide reports. */
    private function opening(Account $a, ?int $branchId): string
    {
        if ($branchId !== null || Money::isZero($a->opening_balance)) {
            return '0.00';
        }

        return $a->normal_balance === 'debit' ? Money::of($a->opening_balance) : Money::sub(0, $a->opening_balance);
    }

    public function trialBalance(?int $branchId, string $asOf): array
    {
        $totals = $this->totals($branchId, null, $asOf);
        $rows = [];
        $sumDr = $sumCr = '0.00';

        foreach ($this->accounts() as $a) {
            $t = $totals[$a->id] ?? null;
            $net = Money::add($this->opening($a, $branchId), $t ? Money::sub($t->debit, $t->credit) : 0);
            if (Money::isZero($net)) {
                continue;
            }
            $dr = Money::isPositive($net) ? $net : '0.00';
            $cr = Money::isNegative($net) ? Money::sub(0, $net) : '0.00';
            $rows[] = ['account_id' => $a->id, 'code' => $a->code, 'name' => $a->name, 'type' => $a->type, 'group' => $a->group?->name, 'debit' => $dr, 'credit' => $cr];
            $sumDr = Money::add($sumDr, $dr);
            $sumCr = Money::add($sumCr, $cr);
        }

        return ['as_of' => $asOf, 'rows' => $rows, 'total_debit' => $sumDr, 'total_credit' => $sumCr,
            'balanced' => Money::compare($sumDr, $sumCr) === 0];
    }

    public function profitAndLoss(?int $branchId, string $from, string $to): array
    {
        $totals = $this->totals($branchId, $from, $to);
        $income = $expense = [];
        $ti = $te = '0.00';

        foreach ($this->accounts()->whereIn('type', ['income', 'expense']) as $a) {
            $t = $totals[$a->id] ?? null;
            if (! $t) {
                continue;
            }
            if ($a->type === 'income') {
                $amt = Money::sub($t->credit, $t->debit);
                $income[] = ['code' => $a->code, 'name' => $a->name, 'group' => $a->group?->name, 'amount' => $amt];
                $ti = Money::add($ti, $amt);
            } else {
                $amt = Money::sub($t->debit, $t->credit);
                $expense[] = ['code' => $a->code, 'name' => $a->name, 'group' => $a->group?->name, 'amount' => $amt];
                $te = Money::add($te, $amt);
            }
        }

        return ['from' => $from, 'to' => $to, 'income' => $income, 'expenses' => $expense,
            'total_income' => $ti, 'total_expenses' => $te, 'net_profit' => Money::sub($ti, $te)];
    }

    public function balanceSheet(?int $branchId, string $asOf): array
    {
        $totals = $this->totals($branchId, null, $asOf);
        $sections = ['asset' => [], 'liability' => [], 'equity' => []];
        $sums = ['asset' => '0.00', 'liability' => '0.00', 'equity' => '0.00'];
        $profit = '0.00';

        foreach ($this->accounts() as $a) {
            $t = $totals[$a->id] ?? null;
            $net = Money::add($this->opening($a, $branchId), $t ? Money::sub($t->debit, $t->credit) : 0);   // debit positive
            if ($a->type === 'income' || $a->type === 'expense') {
                $profit = Money::sub($profit, $net);          // income credit (negative net) adds to profit
                continue;
            }
            if (Money::isZero($net)) {
                continue;
            }
            $amount = $a->type === 'asset' ? $net : Money::sub(0, $net);
            $sections[$a->type][] = ['code' => $a->code, 'name' => $a->name, 'group' => $a->group?->name, 'amount' => $amount];
            $sums[$a->type] = Money::add($sums[$a->type], $amount);
        }

        $equityWithProfit = Money::add($sums['equity'], $profit);

        return [
            'as_of' => $asOf,
            'assets' => $sections['asset'], 'liabilities' => $sections['liability'], 'equity' => $sections['equity'],
            'total_assets' => $sums['asset'], 'total_liabilities' => $sums['liability'],
            'total_equity' => $sums['equity'], 'current_profit' => $profit,
            'total_liabilities_and_equity' => Money::add($sums['liability'], $equityWithProfit),
            'balanced' => Money::compare($sums['asset'], Money::add($sums['liability'], $equityWithProfit)) === 0,
        ];
    }
}
