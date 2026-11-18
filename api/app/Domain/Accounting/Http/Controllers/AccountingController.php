<?php

namespace App\Domain\Accounting\Http\Controllers;

use App\Domain\Accounting\Models\Account;
use App\Domain\Accounting\Models\AccountGroup;
use App\Domain\Accounting\Models\DayClosing;
use App\Domain\Accounting\Models\JournalEntry;
use App\Domain\Accounting\Models\Voucher;
use App\Domain\Accounting\Services\AccountBalances;
use App\Domain\Accounting\Services\CashBookService;
use App\Domain\Accounting\Services\JournalLineData;
use App\Domain\Accounting\Services\LedgerPoster;
use App\Domain\Accounting\Services\VoucherService;
use App\Domain\Core\Support\BranchContext;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AccountingController extends Controller
{
    public function __construct(private BranchContext $branch, private AccountBalances $balances) {}

    /** Working branch, or null (= all branches) when asked and allowed. */
    private function reportBranch(Request $request): ?int
    {
        if ($request->query('branch') === 'all') {
            $this->authorize('reports.all_branches');

            return null;
        }

        return $this->branch->requireId();
    }

    // ---------------------------------------------------------------- chart of accounts

    public function accounts(Request $request): JsonResponse
    {
        $this->authorize('accounting.view');
        $asOf = $request->query('as_of', today()->toDateString());
        $branchId = $this->reportBranch($request);
        $totals = DB::table('journal_lines')->where('entry_date', '<=', $asOf)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->groupBy('account_id')->selectRaw('account_id, SUM(debit) - SUM(credit) AS net')->pluck('net', 'account_id');

        return response()->json(['data' => [
            'groups' => AccountGroup::orderBy('code')->get(['id', 'code', 'name', 'type', 'parent_id']),
            'accounts' => Account::orderBy('code')->get()->map(fn (Account $a) => $a->toArray() + [
                // Shown in the account's normal direction (credit accounts positive when in credit).
                'balance' => number_format(((float) ($totals[$a->id] ?? 0)) * ($a->normal_balance === 'debit' ? 1 : -1), 2, '.', ''),
            ]),
        ]]);
    }

    /** Active accounts for dropdowns (vouchers, journals, cheques, transfers). */
    public function accountOptions(Request $request): JsonResponse
    {
        abort_unless($request->user()->canAny(['vouchers.create', 'journals.manage', 'banking.view', 'accounting.view']), 403);

        return response()->json(['data' => Account::where('is_active', true)->orderBy('code')
            ->get(['id', 'code', 'name', 'type', 'is_cash', 'is_bank', 'is_system', 'system_key'])]);
    }

    public function storeAccount(Request $request): JsonResponse
    {
        $this->authorize('accounts.manage');
        $d = $request->validate([
            'code' => ['required', 'string', 'max:20', 'unique:accounts,code'],
            'name' => ['required', 'string', 'max:120'],
            'account_group_id' => ['required', 'integer', 'exists:account_groups,id'],
            'opening_balance' => ['nullable', 'numeric'],
        ]);
        $group = AccountGroup::findOrFail($d['account_group_id']);

        return response()->json(['data' => Account::create($d + [
            'type' => $group->type,
            'normal_balance' => in_array($group->type, ['asset', 'expense'], true) ? 'debit' : 'credit',
            'opening_balance' => $d['opening_balance'] ?? 0,
            'is_active' => true,
        ])], 201);
    }

    public function updateAccount(Request $request, Account $account): JsonResponse
    {
        $this->authorize('accounts.manage');
        $d = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'is_active' => ['sometimes', 'boolean'],
            'opening_balance' => ['sometimes', 'numeric'],
        ]);
        if ($account->is_system && isset($d['is_active']) && ! $d['is_active']) {
            abort(422, 'System accounts cannot be deactivated.');
        }
        $account->update($d);

        return response()->json(['data' => $account]);
    }

    // ---------------------------------------------------------------- journals

    public function journals(Request $request): JsonResource
    {
        $this->authorize('accounting.view');
        $f = $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date'], 'q' => ['nullable', 'string', 'max:60'], 'manual' => ['nullable', 'boolean']]);

        return JsonResource::collection(JournalEntry::with(['lines.account:id,code,name', 'poster:id,name'])
            ->when($f['from'] ?? null, fn ($q, $v) => $q->where('entry_date', '>=', $v))
            ->when($f['to'] ?? null, fn ($q, $v) => $q->where('entry_date', '<=', $v))
            ->when($f['q'] ?? null, fn ($q, $v) => $q->where(fn ($w) => $w->where('entry_no', $v)->orWhere('narration', 'like', "%{$v}%")))
            ->when(! empty($f['manual']), fn ($q) => $q->whereNull('source_type'))
            ->orderByDesc('id')->paginate(30)->withQueryString());
    }

    public function storeJournal(Request $request, LedgerPoster $ledger): JsonResponse
    {
        $this->authorize('journals.manage');
        $d = $request->validate([
            'entry_date' => ['required', 'date', 'before_or_equal:today'],
            'narration' => ['required', 'string', 'max:255'],
            'lines' => ['required', 'array', 'min:2', 'max:30'],
            'lines.*.account_id' => ['required', 'integer', 'exists:accounts,id'],
            'lines.*.debit' => ['nullable', 'numeric', 'min:0'],
            'lines.*.credit' => ['nullable', 'numeric', 'min:0'],
            'lines.*.description' => ['nullable', 'string', 'max:255'],
        ]);

        $lines = collect($d['lines'])->flatMap(fn ($l) => array_filter([
            (float) ($l['debit'] ?? 0) > 0 ? JournalLineData::debit((int) $l['account_id'], (string) $l['debit'], $l['description'] ?? null) : null,
            (float) ($l['credit'] ?? 0) > 0 ? JournalLineData::credit((int) $l['account_id'], (string) $l['credit'], $l['description'] ?? null) : null,
        ]))->values()->all();

        try {
            $journal = $ledger->post($lines, $d['narration'], $d['entry_date']);
        } catch (\InvalidArgumentException $e) {
            // Unbalanced / one-sided entries are user input errors here, not server faults.
            throw \Illuminate\Validation\ValidationException::withMessages(['lines' => $e->getMessage()]);
        }

        return response()->json(['data' => $journal->load('lines.account:id,code,name')], 201);
    }

    public function reverseJournal(Request $request, JournalEntry $journal, LedgerPoster $ledger): JsonResponse
    {
        $this->authorize('journals.manage');
        $reason = $request->validate(['reason' => ['required', 'string', 'max:255']])['reason'];
        abort_if($journal->source_type !== null, 422, 'Journals created by pawning, sales or vouchers are corrected from their own screen.');

        return response()->json(['data' => $ledger->reverse($journal, $reason)]);
    }

    // ---------------------------------------------------------------- vouchers

    public function vouchers(Request $request): JsonResource
    {
        $this->authorize('vouchers.create');
        $f = $request->validate(['status' => ['nullable', Rule::in(['pending', 'posted', 'rejected'])], 'type' => ['nullable', Rule::in(Voucher::TYPES)]]);

        return JsonResource::collection(Voucher::with(['account:id,code,name', 'cashAccount:id,code,name', 'requester:id,name', 'approver:id,name'])
            ->when($f['status'] ?? null, fn ($q, $v) => $q->where('status', $v))
            ->when($f['type'] ?? null, fn ($q, $v) => $q->where('type', $v))
            ->orderByDesc('id')->paginate(30)->withQueryString());
    }

    public function storeVoucher(Request $request, VoucherService $service): JsonResponse
    {
        $this->authorize('vouchers.create');
        $d = $request->validate([
            'type' => ['required', Rule::in(Voucher::TYPES)],
            'voucher_date' => ['required', 'date'],
            'account_id' => ['required', 'integer', 'exists:accounts,id'],
            'cash_account_id' => ['required', 'integer', 'exists:accounts,id'],
            'amount' => ['required', 'numeric', 'gt:0', 'max:99999999'],
            'party_name' => ['nullable', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json(['data' => $service->create($d)], 201);
    }

    public function approveVoucher(Voucher $voucher, VoucherService $service): JsonResponse
    {
        $this->authorize('vouchers.approve');

        return response()->json(['data' => $service->approve($voucher)]);
    }

    public function rejectVoucher(Request $request, Voucher $voucher, VoucherService $service): JsonResponse
    {
        $this->authorize('vouchers.approve');
        $reason = $request->validate(['reason' => ['required', 'string', 'max:500']])['reason'];

        return response()->json(['data' => $service->reject($voucher, $reason)]);
    }

    // ---------------------------------------------------------------- cash book & day closing

    public function cashBook(Request $request, CashBookService $books): JsonResponse
    {
        $this->authorize('accounting.view');
        $date = $request->validate(['date' => ['nullable', 'date']])['date'] ?? today()->toDateString();

        return response()->json(['data' => $books->day($this->branch->requireId(), $date)]);
    }

    public function closeDay(Request $request, CashBookService $books): JsonResponse
    {
        $this->authorize('day_closing.close');
        $d = $request->validate(['date' => ['required', 'date'], 'physical_cash' => ['required', 'numeric', 'min:0']]);

        return response()->json(['data' => $books->close($this->branch->requireId(), $d['date'], (string) $d['physical_cash'])]);
    }

    public function reopenDay(Request $request, CashBookService $books): JsonResponse
    {
        $this->authorize('journals.manage');   // accountant / head office level
        $d = $request->validate(['date' => ['required', 'date'], 'reason' => ['required', 'string', 'max:500']]);
        $closing = $books->reopen($this->branch->requireId(), $d['date']);
        $closing->setRelation('branch', null);
        \App\Domain\Core\Models\AuditLog::create([
            'user_id' => auth()->id(), 'branch_id' => $closing->branch_id, 'auditable_type' => 'day_closing',
            'auditable_id' => $closing->id, 'event' => 'reopened', 'new_values' => ['date' => $d['date'], 'reason' => $d['reason']],
            'ip_address' => $request->ip(),
        ]);

        return response()->json(['data' => $closing]);
    }

    public function closings(): JsonResource
    {
        $this->authorize('accounting.view');

        return JsonResource::collection(DayClosing::with('closer:id,name')->orderByDesc('business_date')->limit(60)->get());
    }

    // ---------------------------------------------------------------- statements

    public function trialBalance(Request $request): JsonResponse
    {
        $this->authorize('accounting.view');
        $asOf = $request->validate(['as_of' => ['nullable', 'date']])['as_of'] ?? today()->toDateString();

        return response()->json(['data' => $this->balances->trialBalance($this->reportBranch($request), $asOf)]);
    }

    public function profitAndLoss(Request $request): JsonResponse
    {
        $this->authorize('accounting.view');
        $d = $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date']]);

        return response()->json(['data' => $this->balances->profitAndLoss(
            $this->reportBranch($request), $d['from'] ?? today()->startOfMonth()->toDateString(), $d['to'] ?? today()->toDateString(),
        )]);
    }

    public function balanceSheet(Request $request): JsonResponse
    {
        $this->authorize('accounting.view');
        $asOf = $request->validate(['as_of' => ['nullable', 'date']])['as_of'] ?? today()->toDateString();

        return response()->json(['data' => $this->balances->balanceSheet($this->reportBranch($request), $asOf)]);
    }
}
