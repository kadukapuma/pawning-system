<?php

namespace App\Domain\Reports\Services;

use App\Domain\Accounting\Models\Account;
use App\Domain\Accounting\Services\AccountBalances;
use App\Domain\Core\Support\Money;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Dashboard figures and the tabular reports (old Reports menu). Every report
 * returns the same shape so one screen can show, total and export any of them:
 *   ['title', 'columns' => [[key, label, type]], 'rows' => [...], 'totals' => [...]]
 * $branchId = null means all branches.
 */
class ReportService
{
    public const REPORTS = [
        'pawns' => 'New pawns',
        'articles' => 'Pledged articles',
        'part_payments' => 'Part payments',
        'renewals' => 'Renewals',
        'redemptions' => 'Redemptions',
        'cancellations' => 'Cancelled tickets',
        'portfolio' => 'Outstanding portfolio (aging)',
        'letters' => 'Arrears letters issued',
        'forfeits' => 'Forfeitures',
        'sales' => 'Sales of forfeited articles',
        'expenses' => 'Expenses & vouchers',
        'day_closings' => 'Day closings & cash variance',
        'top_customers' => 'Top customers by outstanding capital',
    ];

    public function __construct(private AccountBalances $balances) {}

    // ------------------------------------------------------------------ dashboard

    public function dashboard(?int $branchId): array
    {
        $today = CarbonImmutable::today();
        $tickets = fn () => DB::table('pawn_tickets')->when($branchId, fn ($q) => $q->where('branch_id', $branchId));
        $txns = fn () => DB::table('pawn_transactions')->when($branchId, fn ($q) => $q->where('branch_id', $branchId));

        $active = $tickets()->where('status', 'active')->selectRaw('COUNT(*) c, COALESCE(SUM(principal_current),0) s, COALESCE(SUM(net_weight),0) w')->first();
        $overdue = $tickets()->where('status', 'active')->where('maturity_date', '<', $today)->selectRaw('COUNT(*) c, COALESCE(SUM(principal_current),0) s')->first();

        $todayByType = $txns()->where('business_date', $today)->groupBy('type')
            ->selectRaw('type, COUNT(*) c, SUM(cash_paid) paid, SUM(cash_received) received')->get()->keyBy('type');

        $cash = Account::system('cash');
        $monthStart = $today->startOfMonth()->toDateString();
        $income = DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')
            ->where('a.type', 'income')->where('l.entry_date', '>=', $monthStart)
            ->when($branchId, fn ($q) => $q->where('l.branch_id', $branchId))
            ->selectRaw('COALESCE(SUM(l.credit) - SUM(l.debit), 0) v')->value('v');

        // 30-day trend: cash lent vs cash collected through pawning.
        $from = $today->subDays(29);
        $daily = $txns()->whereBetween('business_date', [$from->toDateString(), $today->toDateString()])
            ->groupBy('business_date')
            ->selectRaw('business_date d, SUM(cash_paid) lent, SUM(cash_received) collected, SUM(type = \'pawn\') pawns')
            ->get()->keyBy(fn ($r) => substr((string) $r->d, 0, 10));
        $trend = [];
        for ($d = $from; $d->lte($today); $d = $d->addDay()) {
            $r = $daily[$d->toDateString()] ?? null;
            $trend[] = ['date' => $d->toDateString(), 'lent' => Money::of($r?->lent), 'collected' => Money::of($r?->collected), 'pawns' => (int) ($r?->pawns ?? 0)];
        }

        $schemes = $tickets()->join('pawn_schemes as s', 's.id', '=', 'pawn_tickets.scheme_id')->where('pawn_tickets.status', 'active')
            ->groupBy('s.code')->orderBy('s.code')
            ->selectRaw('s.code, COUNT(*) c, SUM(pawn_tickets.principal_current) s')->get()
            ->map(fn ($r) => ['scheme' => $r->code, 'tickets' => (int) $r->c, 'capital' => Money::of($r->s)]);

        $stages = $tickets()->where('status', 'active')->groupBy('arrears_stage')->selectRaw('arrears_stage, COUNT(*) c')->pluck('c', 'arrears_stage');
        $stock = DB::table('inventory_items')->where('status', 'in_stock')->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->selectRaw('COUNT(*) c, COALESCE(SUM(sale_price),0) v')->first();

        $t = fn (string $type, string $col) => Money::of($todayByType[$type]->{$col} ?? 0);

        return [
            'as_of' => $today->toDateString(),
            'active' => ['tickets' => (int) $active->c, 'capital' => Money::of($active->s), 'net_weight' => (string) $active->w],
            'overdue' => ['tickets' => (int) $overdue->c, 'capital' => Money::of($overdue->s)],
            'today' => [
                'pawns' => (int) ($todayByType['pawn']->c ?? 0), 'lent' => $t('pawn', 'paid'),
                'redemptions' => (int) ($todayByType['redemption']->c ?? 0), 'redeemed' => $t('redemption', 'received'),
                'part_payments' => (int) ($todayByType['part_payment']->c ?? 0), 'part_paid' => $t('part_payment', 'received'),
                'renewals' => (int) ($todayByType['renewal']->c ?? 0),
            ],
            'cash_in_hand' => $branchId ? $this->balances->balance($cash->id, $branchId) : $this->balances->balance($cash->id),
            'income_this_month' => Money::of($income),
            'arrears' => [
                'letter_1' => (int) ($stages['letter_1'] ?? 0), 'letter_2' => (int) ($stages['letter_2'] ?? 0),
                'letter_3' => (int) ($stages['letter_3'] ?? 0), 'reminder' => (int) ($stages['reminder'] ?? 0),
                'forfeit_queued' => (int) ($stages['forfeit_queued'] ?? 0),
            ],
            'stock' => ['items' => (int) $stock->c, 'value' => Money::of($stock->v)],
            'trend' => $trend,
            'schemes' => $schemes,
            'pending_vouchers' => DB::table('vouchers')->where('status', 'pending')->when($branchId, fn ($q) => $q->where('branch_id', $branchId))->count(),
        ];
    }

    // ------------------------------------------------------------------ tabular reports

    public function run(string $report, ?int $branchId, string $from, string $to): array
    {
        if (! isset(self::REPORTS[$report])) {
            throw new InvalidArgumentException("Unknown report [{$report}].");
        }
        $method = lcfirst(str_replace('_', '', ucwords($report, '_')));
        [$columns, $rows] = $this->{$method}($branchId, $from, $to);

        $totals = [];
        foreach ($columns as [$key, , $type]) {
            if (in_array($type, ['money', 'weight', 'int'], true)) {
                $sum = $rows->sum(fn ($r) => (float) ($r->{$key} ?? 0));
                $totals[$key] = $type === 'int' ? (int) $sum : number_format($sum, $type === 'weight' ? 3 : 2, '.', '');
            }
        }

        return [
            'report' => $report,
            'title' => self::REPORTS[$report],
            'from' => $from, 'to' => $to,
            'columns' => array_map(fn ($c) => ['key' => $c[0], 'label' => $c[1], 'type' => $c[2]], $columns),
            'rows' => $rows->values(),
            'totals' => $totals + ['count' => $rows->count()],
        ];
    }

    private function scoped(Builder $q, ?int $branchId, string $column = 'branch_id'): Builder
    {
        return $q->when($branchId, fn ($w) => $w->where($column, $branchId));
    }

    private function ticketBase(?int $branchId): Builder
    {
        return $this->scoped(DB::table('pawn_tickets as t'), $branchId, 't.branch_id')
            ->join('customers as c', 'c.id', '=', 't.customer_id')
            ->join('branches as b', 'b.id', '=', 't.branch_id')
            ->join('pawn_schemes as s', 's.id', '=', 't.scheme_id');
    }

    private function pawns(?int $branchId, string $from, string $to): array
    {
        return [[
            ['pawn_date', 'Date', 'date'], ['branch', 'Branch', 'text'], ['receipt_no', 'Receipt', 'text'], ['stock_no', 'Stock', 'text'],
            ['customer', 'Customer', 'text'], ['nic', 'NIC', 'text'], ['scheme', 'Scheme', 'text'], ['net_weight', 'Net g', 'weight'],
            ['assessed_value', 'Value', 'money'], ['principal_original', 'Loan', 'money'], ['valid_months', 'Months', 'int'],
            ['maturity_date', 'Maturity', 'date'], ['status', 'Status', 'text'], ['opening', 'Opening', 'text'],
        ], $this->ticketBase($branchId)->whereBetween('t.pawn_date', [$from, $to])->orderBy('t.pawn_date')->orderBy('t.id')
            ->get(['t.pawn_date', 'b.code as branch', 't.receipt_no', 't.stock_no', 'c.full_name as customer', 'c.nic', 's.code as scheme',
                't.net_weight', 't.assessed_value', 't.principal_original', 't.valid_months', 't.maturity_date', 't.status',
                DB::raw("IF(t.is_opening, 'yes', '') as opening")])];
    }

    private function articles(?int $branchId, string $from, string $to): array
    {
        return [[
            ['category', 'Category', 'text'], ['karat', 'Karat', 'text'], ['items', 'Items', 'int'], ['quantity', 'Qty', 'int'],
            ['gross_weight', 'Gross g', 'weight'], ['net_weight', 'Net g', 'weight'], ['assessed_value', 'Value', 'money'],
        ], $this->scoped(DB::table('pawn_ticket_items as i'), $branchId, 't.branch_id')
            ->join('pawn_tickets as t', 't.id', '=', 'i.pawn_ticket_id')
            ->join('article_categories as cat', 'cat.id', '=', 'i.category_id')
            ->join('karats as k', 'k.id', '=', 'i.karat_id')
            ->whereBetween('t.pawn_date', [$from, $to])->where('t.status', '!=', 'cancelled')
            ->groupBy('cat.name', 'k.name', 'k.sort_order')->orderBy('cat.name')->orderBy('k.sort_order')
            ->get(['cat.name as category', 'k.name as karat', DB::raw('COUNT(*) as items'), DB::raw('SUM(i.quantity) as quantity'),
                DB::raw('SUM(i.gross_weight) as gross_weight'), DB::raw('SUM(i.net_weight) as net_weight'), DB::raw('SUM(i.assessed_value) as assessed_value')])];
    }

    private function txnReport(?int $branchId, string $from, string $to, string $type, array $money): array
    {
        $cols = array_merge([['business_date', 'Date', 'date'], ['branch', 'Branch', 'text'], ['txn_no', 'No.', 'text'], ['receipt_no', 'Receipt', 'text'],
            ['customer', 'Customer', 'text'], ['interest_days', 'Days', 'int']], $money, [['user', 'By', 'text']]);

        $q = $this->scoped(DB::table('pawn_transactions as x'), $branchId, 'x.branch_id')
            ->join('pawn_tickets as t', 't.id', '=', 'x.pawn_ticket_id')
            ->join('customers as c', 'c.id', '=', 't.customer_id')
            ->join('branches as b', 'b.id', '=', 'x.branch_id')
            ->leftJoin('users as u', 'u.id', '=', 'x.created_by')
            ->where('x.type', $type)->whereBetween('x.business_date', [$from, $to])
            ->orderBy('x.business_date')->orderBy('x.id');

        return [$cols, $q->get(array_merge(['x.business_date', 'b.code as branch', 'x.txn_no', 't.receipt_no', 'c.full_name as customer', 'x.interest_days', 'u.name as user'],
            array_map(fn ($c) => "x.{$c[0]}", $money)))];
    }

    private function partPayments(?int $b, string $f, string $t): array
    {
        return $this->txnReport($b, $f, $t, 'part_payment', [
            ['principal_before', 'Capital before', 'money'], ['interest_due', 'Interest', 'money'], ['postage_charge', 'Postage', 'money'],
            ['discount', 'Discount', 'money'], ['cash_received', 'Received', 'money'], ['principal_paid', 'Capital paid', 'money'],
            ['interest_capitalised', 'Interest added', 'money'], ['principal_after', 'Capital after', 'money'],
        ]);
    }

    private function renewals(?int $b, string $f, string $t): array
    {
        return $this->txnReport($b, $f, $t, 'renewal', [
            ['principal_before', 'Capital before', 'money'], ['interest_due', 'Interest', 'money'], ['service_charge', 'Service', 'money'],
            ['postage_charge', 'Postage', 'money'], ['stamp_duty', 'Stamp', 'money'], ['discount', 'Discount', 'money'],
            ['cash_paid', 'Extra cash', 'money'], ['principal_after', 'New capital', 'money'],
        ]);
    }

    private function redemptions(?int $b, string $f, string $t): array
    {
        return $this->txnReport($b, $f, $t, 'redemption', [
            ['principal_paid', 'Capital', 'money'], ['interest_due', 'Interest', 'money'], ['service_charge', 'Service', 'money'],
            ['postage_charge', 'Postage', 'money'], ['stamp_duty', 'Stamp', 'money'], ['discount', 'Discount', 'money'], ['cash_received', 'Received', 'money'],
        ]);
    }

    private function cancellations(?int $branchId, string $from, string $to): array
    {
        return [[
            ['cancelled_at', 'Cancelled', 'date'], ['branch', 'Branch', 'text'], ['receipt_no', 'Receipt', 'text'], ['customer', 'Customer', 'text'],
            ['principal_original', 'Loan', 'money'], ['cancel_reason', 'Reason', 'text'], ['user', 'By', 'text'],
        ], $this->ticketBase($branchId)->leftJoin('users as u', 'u.id', '=', 't.cancelled_by')
            ->where('t.status', 'cancelled')->whereBetween(DB::raw('DATE(t.cancelled_at)'), [$from, $to])->orderBy('t.cancelled_at')
            ->get([DB::raw('DATE(t.cancelled_at) as cancelled_at'), 'b.code as branch', 't.receipt_no', 'c.full_name as customer',
                't.principal_original', 't.cancel_reason', 'u.name as user'])];
    }

    /** Active tickets as of today with days overdue and an aging bucket. `from/to` filter by pawn date. */
    private function portfolio(?int $branchId, string $from, string $to): array
    {
        $rows = $this->ticketBase($branchId)->where('t.status', 'active')->whereBetween('t.pawn_date', [$from, $to])
            ->orderBy('t.maturity_date')
            ->get(['b.code as branch', 't.receipt_no', 'c.full_name as customer', 'c.phone1 as phone', 's.code as scheme', 't.pawn_date',
                't.maturity_date', 't.principal_current', 't.assessed_value', 't.arrears_stage',
                // App date (Asia/Colombo), not the DB server's CURDATE().
                DB::raw("GREATEST(DATEDIFF('".today()->toDateString()."', t.maturity_date), 0) as days_overdue")])
            ->map(function ($r) {
                $d = (int) $r->days_overdue;
                $r->aging = match (true) { $d === 0 => 'Current', $d <= 30 => '1–30 days', $d <= 60 => '31–60 days', $d <= 90 => '61–90 days', default => '90+ days' };
                $r->arrears_stage = str_replace('_', ' ', $r->arrears_stage);

                return $r;
            });

        return [[
            ['branch', 'Branch', 'text'], ['receipt_no', 'Receipt', 'text'], ['customer', 'Customer', 'text'], ['phone', 'Phone', 'text'],
            ['scheme', 'Scheme', 'text'], ['pawn_date', 'Pawned', 'date'], ['maturity_date', 'Maturity', 'date'],
            ['days_overdue', 'Days overdue', 'int'], ['aging', 'Aging', 'text'], ['arrears_stage', 'Stage', 'text'],
            ['principal_current', 'Capital', 'money'], ['assessed_value', 'Value', 'money'],
        ], $rows];
    }

    private function letters(?int $branchId, string $from, string $to): array
    {
        return [[
            ['issued', 'Printed', 'date'], ['branch', 'Branch', 'text'], ['letter_no', 'Letter', 'int'], ['receipt_no', 'Receipt', 'text'],
            ['customer', 'Customer', 'text'], ['address', 'Address', 'text'], ['phone', 'Phone', 'text'], ['postage_charge', 'Postage', 'money'],
            ['principal_current', 'Capital', 'money'],
        ], $this->scoped(DB::table('arrears_letters as l'), $branchId, 'l.branch_id')
            ->join('pawn_tickets as t', 't.id', '=', 'l.pawn_ticket_id')
            ->join('customers as c', 'c.id', '=', 't.customer_id')
            ->join('branches as b', 'b.id', '=', 'l.branch_id')
            ->whereBetween(DB::raw('DATE(l.issued_at)'), [$from, $to])->orderBy('l.issued_at')
            ->get([DB::raw('DATE(l.issued_at) as issued'), 'b.code as branch', 'l.letter_no', 't.receipt_no', 'c.full_name as customer',
                DB::raw("CONCAT_WS(', ', c.address_line1, c.city) as address"), 'c.phone1 as phone', 'l.postage_charge', 't.principal_current'])];
    }

    private function forfeits(?int $branchId, string $from, string $to): array
    {
        return [[
            ['forfeit_date', 'Date', 'date'], ['branch', 'Branch', 'text'], ['forfeit_no', 'No.', 'text'], ['receipt_no', 'Receipt', 'text'],
            ['customer', 'Customer', 'text'], ['net_weight', 'Net g', 'weight'], ['principal_at_forfeit', 'Capital', 'money'],
            ['interest_at_forfeit', 'Unpaid interest', 'money'], ['charges_at_forfeit', 'Unpaid charges', 'money'], ['total_due', 'Total due', 'money'],
        ], $this->scoped(DB::table('forfeitures as f'), $branchId, 'f.branch_id')
            ->join('pawn_tickets as t', 't.id', '=', 'f.pawn_ticket_id')
            ->join('customers as c', 'c.id', '=', 't.customer_id')
            ->join('branches as b', 'b.id', '=', 'f.branch_id')
            ->whereBetween('f.forfeit_date', [$from, $to])->orderBy('f.forfeit_date')
            ->get(['f.forfeit_date', 'b.code as branch', 'f.forfeit_no', 't.receipt_no', 'c.full_name as customer', 't.net_weight',
                'f.principal_at_forfeit', 'f.interest_at_forfeit', 'f.charges_at_forfeit', 'f.total_due'])];
    }

    private function sales(?int $branchId, string $from, string $to): array
    {
        return [[
            ['date', 'Date', 'date'], ['branch', 'Branch', 'text'], ['invoice_no', 'Invoice', 'text'], ['customer_name', 'Customer', 'text'],
            ['items', 'Items', 'int'], ['cost', 'Cost', 'money'], ['net_amount', 'Sold for', 'money'], ['profit', 'Profit', 'money'], ['status', 'Status', 'text'],
        ], $this->scoped(DB::table('sales_invoices as s'), $branchId, 's.branch_id')
            ->join('branches as b', 'b.id', '=', 's.branch_id')
            ->join('sales_invoice_lines as l', 'l.sales_invoice_id', '=', 's.id')
            ->join('inventory_items as i', 'i.id', '=', 'l.inventory_item_id')
            ->whereBetween(DB::raw('DATE(s.invoice_date)'), [$from, $to])
            ->groupBy('s.id', 's.invoice_date', 'b.code', 's.invoice_no', 's.customer_name', 's.net_amount', 's.status')
            ->orderBy('s.invoice_date')
            ->get([DB::raw('DATE(s.invoice_date) as date'), 'b.code as branch', 's.invoice_no', 's.customer_name', DB::raw('COUNT(l.id) as items'),
                DB::raw('SUM(i.cost_price) as cost'), 's.net_amount', DB::raw('s.net_amount - SUM(i.cost_price) as profit'), 's.status'])];
    }

    private function expenses(?int $branchId, string $from, string $to): array
    {
        return [[
            ['voucher_date', 'Date', 'date'], ['branch', 'Branch', 'text'], ['voucher_no', 'Voucher', 'text'], ['type', 'Type', 'text'],
            ['account', 'Account', 'text'], ['party_name', 'Party', 'text'], ['description', 'Description', 'text'], ['amount', 'Amount', 'money'],
            ['status', 'Status', 'text'],
        ], $this->scoped(DB::table('vouchers as v'), $branchId, 'v.branch_id')
            ->join('accounts as a', 'a.id', '=', 'v.account_id')
            ->join('branches as b', 'b.id', '=', 'v.branch_id')
            ->whereBetween('v.voucher_date', [$from, $to])->orderBy('v.voucher_date')
            ->get(['v.voucher_date', 'b.code as branch', 'v.voucher_no', 'v.type', 'a.name as account', 'v.party_name', 'v.description', 'v.amount', 'v.status'])];
    }

    private function dayClosings(?int $branchId, string $from, string $to): array
    {
        return [[
            ['business_date', 'Date', 'date'], ['branch', 'Branch', 'text'], ['opening_cash', 'Opening', 'money'], ['total_in', 'In', 'money'],
            ['total_out', 'Out', 'money'], ['closing_cash', 'Book closing', 'money'], ['physical_cash', 'Counted', 'money'],
            ['variance', 'Variance', 'money'], ['status', 'Status', 'text'], ['user', 'Closed by', 'text'],
        ], $this->scoped(DB::table('day_closings as d'), $branchId, 'd.branch_id')
            ->join('branches as b', 'b.id', '=', 'd.branch_id')
            ->leftJoin('users as u', 'u.id', '=', 'd.closed_by')
            ->whereBetween('d.business_date', [$from, $to])->orderBy('d.business_date')->orderBy('b.code')
            ->get(['d.business_date', 'b.code as branch', 'd.opening_cash', 'd.total_in', 'd.total_out', 'd.closing_cash', 'd.physical_cash', 'd.variance', 'd.status', 'u.name as user'])];
    }

    private function topCustomers(?int $branchId, string $from, string $to): array
    {
        return [[
            ['code', 'Code', 'text'], ['customer', 'Customer', 'text'], ['nic', 'NIC', 'text'], ['phone', 'Phone', 'text'],
            ['tickets', 'Active tickets', 'int'], ['capital', 'Outstanding capital', 'money'], ['overdue', 'Overdue tickets', 'int'],
        ], $this->scoped(DB::table('pawn_tickets as t'), $branchId, 't.branch_id')
            ->join('customers as c', 'c.id', '=', 't.customer_id')
            ->where('t.status', 'active')
            ->groupBy('c.id', 'c.code', 'c.full_name', 'c.nic', 'c.phone1')
            ->orderByDesc(DB::raw('SUM(t.principal_current)'))->limit(100)
            ->get(['c.code', 'c.full_name as customer', 'c.nic', 'c.phone1 as phone', DB::raw('COUNT(*) as tickets'),
                DB::raw('SUM(t.principal_current) as capital'), DB::raw("SUM(t.maturity_date < '".today()->toDateString()."') as overdue")])];
    }
}
