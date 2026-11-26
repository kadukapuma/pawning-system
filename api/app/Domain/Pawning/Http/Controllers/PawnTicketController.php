<?php

namespace App\Domain\Pawning\Http\Controllers;

use App\Domain\Core\Models\Company;
use App\Domain\Customers\Models\Customer;
use App\Domain\Pawning\Http\Resources\PawnTicketResource;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Models\PawnTransaction;
use App\Domain\Pawning\Services\PartPaymentService;
use App\Domain\Pawning\Services\PawnService;
use App\Domain\Pawning\Services\RedemptionService;
use App\Domain\Pawning\Services\RenewalService;
use App\Domain\Pawning\Services\TicketAdminService;
use App\Domain\Pawning\Services\TicketCalculator;
use App\Domain\Sms\Services\SlipNotifier;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

class PawnTicketController extends Controller
{
    private const DETAIL = ['branch', 'customer', 'scheme', 'schemeVersion', 'items.category', 'items.articleType',
        'items.condition', 'items.karat', 'transactions.creator', 'events.user', 'letters', 'creator'];

    public function __construct(private TicketCalculator $calculator) {}

    // ------------------------------------------------------------------ queries

    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('pawn.view');
        $f = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(['active', 'redeemed', 'forfeited', 'cancelled'])],
            'blocked' => ['nullable', 'boolean'],
            'overdue' => ['nullable', 'boolean'],
        ]);
        $q = trim((string) ($f['q'] ?? ''));

        $tickets = PawnTicket::query()
            ->with(['customer', 'scheme'])
            ->when($q !== '', fn ($query) => $query->where(fn ($w) => $w
                ->whereIn('receipt_no', [$q])->orWhere('ticket_no', $q)->orWhere('stock_no', $q)->orWhere('legacy_receipt_no', $q)
                ->orWhereHas('customer', fn ($c) => $c->search($q))))
            ->when($f['status'] ?? null, fn ($query, $s) => $query->where('status', $s))
            ->when(isset($f['blocked']), fn ($query) => $query->where('is_blocked', (bool) $f['blocked']))
            ->when(! empty($f['overdue']), fn ($query) => $query->where('status', 'active')->where('maturity_date', '<', today()))
            ->orderByDesc('id')
            ->paginate(25)
            ->withQueryString();

        return PawnTicketResource::collection($tickets);
    }

    public function show(PawnTicket $ticket): PawnTicketResource
    {
        $this->authorize('pawn.view');
        $ticket->load(self::DETAIL);
        $resource = new PawnTicketResource($ticket);

        return $ticket->isActive() ? $resource->withStatement($this->calculator->statement($ticket)->toArray()) : $resource;
    }

    /** Statement on any date (e.g. to tell a customer what they will owe next week). */
    public function statement(Request $request, PawnTicket $ticket): JsonResponse
    {
        $this->authorize('pawn.view');
        $date = $request->validate(['date' => ['nullable', 'date']])['date'] ?? null;

        return response()->json(['data' => $this->calculator->statement($ticket, $date)->toArray()]);
    }

    public function forCustomer(Customer $customer): AnonymousResourceCollection
    {
        $this->authorize('pawn.view');

        return PawnTicketResource::collection(
            PawnTicket::withoutBranchScope()->with(['branch', 'scheme'])->where('customer_id', $customer->id)
                ->orderByRaw("status = 'active' DESC")->orderByDesc('id')->limit(200)->get()
        );
    }

    /** Everything needed to print a transaction receipt. */
    public function transaction(int $id): JsonResponse
    {
        $this->authorize('pawn.view');
        $txn = PawnTransaction::with(['creator:id,name'])->findOrFail($id);
        $ticket = PawnTicket::with(self::DETAIL)->findOrFail($txn->pawn_ticket_id);

        return response()->json(['data' => [
            'transaction' => $txn,
            'ticket' => (new PawnTicketResource($ticket))->resolve(),
            'company' => Company::current(),
        ]]);
    }

    // ------------------------------------------------------------------ new pawn

    public function quote(Request $request, PawnService $service): JsonResponse
    {
        $this->authorize('pawn.create');
        $data = $request->validate($this->itemRules() + ['amount' => ['nullable', 'numeric', 'min:0']]);

        return response()->json(['data' => $service->quote($data['items'], isset($data['amount']) ? (string) $data['amount'] : null)]);
    }

    public function store(Request $request, PawnService $service, SlipNotifier $slips): JsonResponse
    {
        $this->authorize('pawn.create');
        $data = $request->validate($this->itemRules() + [
            'customer_id' => ['required', 'integer', 'exists:customers,id'],
            'amount' => ['required', 'numeric', 'min:100', 'max:99999999'],
            'months' => ['required', 'integer', 'min:1', 'max:60'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);

        $ticket = $service->create($data);
        $slips->afterTransaction($ticket->transactions()->first());

        return $this->created($ticket);
    }

    public function storeOpening(Request $request, PawnService $service): JsonResponse
    {
        $this->authorize('pawn.create_opening');
        $data = $request->validate($this->itemRules() + [
            'customer_id' => ['required', 'integer', 'exists:customers,id'],
            'principal' => ['required', 'numeric', 'min:1', 'max:99999999'],
            'pawn_date' => ['required', 'date', 'before_or_equal:today'],
            'months' => ['required', 'integer', 'min:1', 'max:60'],
            'legacy_receipt_no' => ['required', 'string', 'max:30'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);

        return $this->created($service->createOpening($data));
    }

    // ------------------------------------------------------------------ actions

    public function partPaymentQuote(Request $request, PawnTicket $ticket, PartPaymentService $s): JsonResponse
    {
        $this->authorize('pawn.part_payment');
        $d = $request->validate(['amount' => ['required', 'numeric', 'min:0'], 'discount' => ['nullable', 'numeric', 'min:0'], 'months' => ['nullable', 'integer', 'min:1']]);

        return $this->quoteResponse($s->quote($ticket, (string) $d['amount'], (string) ($d['discount'] ?? 0), (int) ($d['months'] ?? 1)));
    }

    public function partPayment(Request $request, PawnTicket $ticket, PartPaymentService $s, SlipNotifier $slips): JsonResponse
    {
        $this->authorize('pawn.part_payment');
        $d = $request->validate([
            'amount' => ['required', 'numeric', 'gt:0'], 'discount' => ['nullable', 'numeric', 'min:0'],
            'months' => ['required', 'integer', 'min:1'], 'remarks' => ['nullable', 'string', 'max:500'],
        ]);
        $txn = $s->pay($ticket->id, (string) $d['amount'], (string) ($d['discount'] ?? 0), (int) $d['months'], $d['remarks'] ?? null);

        $slips->afterTransaction($txn);

        return response()->json(['data' => $txn], 201);
    }

    public function renewalQuote(Request $request, PawnTicket $ticket, RenewalService $s): JsonResponse
    {
        $this->authorize('pawn.renew');
        $d = $request->validate(['extra_cash' => ['nullable', 'numeric', 'min:0'], 'discount' => ['nullable', 'numeric', 'min:0'], 'months' => ['nullable', 'integer', 'min:1']]);

        return $this->quoteResponse($s->quote($ticket, (string) ($d['extra_cash'] ?? 0), (string) ($d['discount'] ?? 0), (int) ($d['months'] ?? 1)));
    }

    public function renew(Request $request, PawnTicket $ticket, RenewalService $s, SlipNotifier $slips): JsonResponse
    {
        $this->authorize('pawn.renew');
        $d = $request->validate([
            'extra_cash' => ['nullable', 'numeric', 'min:0'], 'discount' => ['nullable', 'numeric', 'min:0'],
            'months' => ['required', 'integer', 'min:1'], 'remarks' => ['nullable', 'string', 'max:500'],
        ]);
        $txn = $s->renew($ticket->id, (string) ($d['extra_cash'] ?? 0), (string) ($d['discount'] ?? 0), (int) $d['months'], $d['remarks'] ?? null);

        $slips->afterTransaction($txn);

        return response()->json(['data' => $txn], 201);
    }

    public function redemptionQuote(Request $request, PawnTicket $ticket, RedemptionService $s): JsonResponse
    {
        $this->authorize('pawn.redeem');
        $d = $request->validate(['discount' => ['nullable', 'numeric', 'min:0']]);

        return $this->quoteResponse($s->quote($ticket, (string) ($d['discount'] ?? 0)));
    }

    public function redeem(Request $request, PawnTicket $ticket, RedemptionService $s, SlipNotifier $slips): JsonResponse
    {
        $this->authorize('pawn.redeem');
        $d = $request->validate([
            'discount' => ['nullable', 'numeric', 'min:0'], 'cash_received' => ['nullable', 'numeric', 'min:0'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);
        $txn = $s->redeem($ticket->id, (string) ($d['discount'] ?? 0), isset($d['cash_received']) ? (string) $d['cash_received'] : null, $d['remarks'] ?? null);

        $slips->afterTransaction($txn);

        return response()->json(['data' => $txn], 201);
    }

    public function cancel(Request $request, PawnTicket $ticket, TicketAdminService $s): PawnTicketResource
    {
        $this->authorize('pawn.cancel');
        $reason = $request->validate(['reason' => ['required', 'string', 'max:500']])['reason'];

        return new PawnTicketResource($s->cancel($ticket->id, $reason)->load(self::DETAIL));
    }

    public function block(Request $request, PawnTicket $ticket, TicketAdminService $s): PawnTicketResource
    {
        $this->authorize('pawn.block');
        $d = $request->validate(['blocked' => ['required', 'boolean'], 'reason' => ['required_if:blocked,true', 'nullable', 'string', 'max:500']]);

        return new PawnTicketResource($s->setBlocked($ticket->id, (bool) $d['blocked'], $d['reason'] ?? null)->load(self::DETAIL));
    }

    // ------------------------------------------------------------------ helpers

    private function itemRules(): array
    {
        return [
            'items' => ['required', 'array', 'min:1', 'max:30'],
            'items.*.category_id' => ['required', 'integer', 'exists:article_categories,id'],
            'items.*.article_type_id' => ['nullable', 'integer', 'exists:article_types,id'],
            'items.*.condition_id' => ['nullable', 'integer', 'exists:article_conditions,id'],
            'items.*.karat_id' => ['required', 'integer', 'exists:karats,id'],
            'items.*.description' => ['nullable', 'string', 'max:255'],
            'items.*.quantity' => ['nullable', 'integer', 'min:1', 'max:999'],
            'items.*.gross_weight' => ['required', 'numeric', 'gt:0', 'max:99999'],
            'items.*.net_weight' => ['required', 'numeric', 'gt:0', 'max:99999'],
            'items.*.density_reading' => ['nullable', 'numeric', 'min:0', 'max:9999.999'],
        ];
    }

    private function created(PawnTicket $ticket): JsonResponse
    {
        $ticket->load(self::DETAIL);

        return (new PawnTicketResource($ticket))
            ->withStatement($this->calculator->statement($ticket)->toArray())
            ->response()->setStatusCode(201);
    }

    /** Drop internal objects (keys starting with "_") from a quote. */
    private function quoteResponse(array $quote): JsonResponse
    {
        return response()->json(['data' => array_filter($quote, fn ($k) => ! str_starts_with($k, '_'), ARRAY_FILTER_USE_KEY)]);
    }
}
