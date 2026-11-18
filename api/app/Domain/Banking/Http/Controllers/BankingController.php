<?php

namespace App\Domain\Banking\Http\Controllers;

use App\Domain\Accounting\Services\AccountBalances;
use App\Domain\Banking\Models\BankAccount;
use App\Domain\Banking\Models\BankReconciliation;
use App\Domain\Banking\Models\Cheque;
use App\Domain\Banking\Services\BankingService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

class BankingController extends Controller
{
    public function __construct(private BankingService $banking) {}

    // ---------------------------------------------------------------- accounts & transfers

    public function accounts(AccountBalances $balances): JsonResponse
    {
        $this->authorize('banking.view');

        return response()->json(['data' => BankAccount::with(['bankBranch.bank', 'ledgerAccount:id,code,name'])->orderBy('account_name')->get()
            ->map(fn (BankAccount $b) => $b->toArray() + ['balance' => $balances->balance($b->account_id)])]);
    }

    public function storeAccount(Request $request): JsonResponse
    {
        $this->authorize('banking.manage');
        $d = $request->validate([
            'bank_branch_id' => ['required', 'integer', 'exists:bank_branches,id'],
            'account_no' => ['required', 'string', 'max:30', 'unique:bank_accounts,account_no'],
            'account_name' => ['required', 'string', 'max:120'],
        ]);

        return response()->json(['data' => $this->banking->createBankAccount($d)->load('ledgerAccount')], 201);
    }

    public function transfer(Request $request): JsonResponse
    {
        $this->authorize('banking.manage');
        $d = $request->validate([
            'from_account_id' => ['required', 'integer', 'exists:accounts,id'],
            'to_account_id' => ['required', 'integer', 'exists:accounts,id'],
            'amount' => ['required', 'numeric', 'gt:0'],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'narration' => ['nullable', 'string', 'max:255'],
        ]);

        return response()->json(['data' => $this->banking->transfer($d['from_account_id'], $d['to_account_id'], (string) $d['amount'], $d['date'], $d['narration'] ?? null)], 201);
    }

    // ---------------------------------------------------------------- cheques

    public function cheques(Request $request): JsonResource
    {
        $this->authorize('banking.view');
        $f = $request->validate([
            'direction' => ['nullable', Rule::in(['received', 'issued'])],
            'status' => ['nullable', 'string', 'max:20'],
            'q' => ['nullable', 'string', 'max:30'],
        ]);

        return JsonResource::collection(Cheque::with(['bankBranch.bank:id,name', 'bankAccount:id,account_name,account_no', 'counterAccount:id,code,name'])
            ->when($f['direction'] ?? null, fn ($q, $v) => $q->where('direction', $v))
            ->when($f['status'] ?? null, fn ($q, $v) => $q->where('status', $v))
            ->when($f['q'] ?? null, fn ($q, $v) => $q->where(fn ($w) => $w->where('cheque_no', $v)->orWhere('party_name', 'like', "%{$v}%")))
            ->orderByDesc('id')->paginate(30)->withQueryString());
    }

    public function receive(Request $request): JsonResponse
    {
        $this->authorize('banking.manage');

        return response()->json(['data' => $this->banking->receiveCheque($request->validate($this->chequeRules() + [
            'bank_branch_id' => ['nullable', 'integer', 'exists:bank_branches,id'],
        ]))], 201);
    }

    public function issue(Request $request): JsonResponse
    {
        $this->authorize('banking.manage');

        return response()->json(['data' => $this->banking->issueCheque($request->validate($this->chequeRules() + [
            'bank_account_id' => ['required', 'integer'],
        ]))], 201);
    }

    public function deposit(Request $request, Cheque $cheque): JsonResponse
    {
        $this->authorize('banking.manage');
        $id = $request->validate(['bank_account_id' => ['required', 'integer']])['bank_account_id'];

        return response()->json(['data' => $this->banking->deposit($cheque, $id)]);
    }

    public function clear(Cheque $cheque): JsonResponse
    {
        $this->authorize('banking.manage');

        return response()->json(['data' => $this->banking->clear($cheque)]);
    }

    public function returnCheque(Request $request, Cheque $cheque): JsonResponse
    {
        $this->authorize('banking.manage');
        $reason = $request->validate(['reason' => ['required', 'string', 'max:255']])['reason'];

        return response()->json(['data' => $cheque->direction === 'issued'
            ? $this->banking->cancelIssued($cheque, $reason)
            : $this->banking->returnCheque($cheque, $reason)]);
    }

    private function chequeRules(): array
    {
        return [
            'cheque_no' => ['required', 'string', 'max:20'],
            'party_name' => ['required', 'string', 'max:150'],
            'amount' => ['required', 'numeric', 'gt:0', 'max:99999999'],
            'cheque_date' => ['required', 'date'],
            'counter_account_id' => ['required', 'integer', 'exists:accounts,id'],
        ];
    }

    // ---------------------------------------------------------------- reconciliation

    public function reconciliation(Request $request, BankAccount $bankAccount): JsonResponse
    {
        $this->authorize('banking.reconcile');
        $date = $request->validate(['statement_date' => ['required', 'date']])['statement_date'];
        $existing = BankReconciliation::where('bank_account_id', $bankAccount->id)->whereDate('statement_date', $date)->first();

        return response()->json(['data' => $this->banking->unreconciled($bankAccount, $date, $existing?->id) + [
            'reconciliation' => $existing,
            'history' => BankReconciliation::where('bank_account_id', $bankAccount->id)->orderByDesc('statement_date')->limit(12)->get(),
        ]]);
    }

    public function reconcile(Request $request, BankAccount $bankAccount): JsonResponse
    {
        $this->authorize('banking.reconcile');
        $d = $request->validate([
            'statement_date' => ['required', 'date'],
            'statement_balance' => ['required', 'numeric'],
            'line_ids' => ['present', 'array'],
            'line_ids.*' => ['integer'],
            'complete' => ['sometimes', 'boolean'],
        ]);

        $rec = $this->banking->reconcile($bankAccount, $d['statement_date'], (string) $d['statement_balance'], $d['line_ids'], (bool) ($d['complete'] ?? false));

        return response()->json(['data' => $rec]);
    }
}
