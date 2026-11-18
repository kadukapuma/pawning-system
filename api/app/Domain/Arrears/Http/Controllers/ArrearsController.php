<?php

namespace App\Domain\Arrears\Http\Controllers;

use App\Domain\Arrears\Services\ArrearsService;
use App\Domain\Core\Models\Company;
use App\Domain\Forfeit\Models\ForfeitPromise;
use App\Domain\Forfeit\Models\Forfeiture;
use App\Domain\Forfeit\Services\ForfeitService;
use App\Domain\Inventory\Models\StockTransferBatch;
use App\Domain\Pawning\Models\ArrearsLetter;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Services\TicketCalculator;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Arrears letters, forfeit reminders / promises, forfeit queue, forfeit and stock transfer. */
class ArrearsController extends Controller
{
    public function __construct(
        private ArrearsService $arrears,
        private ForfeitService $forfeit,
        private TicketCalculator $calculator,
    ) {}

    // ---------------------------------------------------------------- letters

    public function due(Request $request): JsonResponse
    {
        $this->authorize('arrears.view');
        $letter = (int) $request->validate(['letter' => ['required', 'integer', 'between:1,3']])['letter'];

        return response()->json(['data' => $this->arrears->due($letter)->map(fn ($r) => $this->row($r['ticket']) + [
            'due_date' => $r['schedule']['next_due'],
            'printed' => $r['schedule']['printed'],
        ])]);
    }

    public function issued(Request $request): JsonResponse
    {
        $this->authorize('arrears.view');
        $f = $request->validate([
            'letter' => ['required', 'integer', 'between:1,3'],
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date'],
        ]);

        $letters = ArrearsLetter::with(['ticket.customer', 'ticket.scheme', 'issuer:id,name'])
            ->where('letter_no', $f['letter'])
            ->when($f['from'] ?? null, fn ($q, $d) => $q->where('issued_at', '>=', $d))
            ->when($f['to'] ?? null, fn ($q, $d) => $q->where('issued_at', '<', now()->parse($d)->addDay()))
            ->orderByDesc('issued_at')->limit(500)->get();

        return response()->json(['data' => $letters->map(fn (ArrearsLetter $l) => [
            'id' => $l->id, 'letter_no' => $l->letter_no, 'cycle_no' => $l->cycle_no,
            'issued_at' => $l->issued_at->toIso8601String(), 'due_date' => $l->due_date->toDateString(),
            'postage_charge' => $l->postage_charge, 'reprint_count' => $l->reprint_count,
            'issued_by' => $l->issuer?->name, 'current_cycle' => $l->cycle_no === $l->ticket->letter_cycle,
            'ticket' => $this->summary($l->ticket),
        ])]);
    }

    public function issue(Request $request): JsonResponse
    {
        $this->authorize('arrears.issue_letters');
        $d = $request->validate([
            'letter_no' => ['required', 'integer', 'between:1,3'],
            'ticket_ids' => ['required', 'array', 'min:1', 'max:500'],
            'ticket_ids.*' => ['integer'],
        ]);
        $result = $this->arrears->issue($d['ticket_ids'], (int) $d['letter_no']);

        return response()->json(['data' => [
            'letter_ids' => collect($result['letters'])->pluck('id')->values(),
            'skipped' => $result['skipped'],
        ]]);
    }

    /** POST because printing again counts a reprint (never charged again). */
    public function print(Request $request): JsonResponse
    {
        $this->authorize('arrears.view');
        $d = $request->validate([
            'letter_ids' => ['required', 'array', 'min:1', 'max:500'],
            'letter_ids.*' => ['integer'],
            'reprint' => ['sometimes', 'boolean'],
        ]);

        return response()->json(['data' => [
            'company' => Company::current(),
            'letters' => $this->arrears->printData($d['letter_ids'], (bool) ($d['reprint'] ?? false)),
        ]]);
    }

    // ---------------------------------------------------------------- reminders & promises

    public function reminders(): JsonResponse
    {
        $this->authorize('forfeit.manage_promises');

        return response()->json(['data' => $this->forfeit->reminders()->map(fn ($r) => $this->row($r['ticket']) + [
            'letter_3_date' => $r['schedule']['printed'][3] ?? null,
            'reminder_due_date' => $r['schedule']['reminder_due_date'],
            'promise' => $r['promise'] ? [
                'id' => $r['promise']->id, 'promise_date' => $r['promise']->promise_date->toDateString(),
                'remark' => $r['promise']->remark, 'status' => $r['promise']->status, 'overdue' => $r['promise']->isOverdue(),
            ] : null,
        ])]);
    }

    public function promises(PawnTicket $ticket): JsonResponse
    {
        $this->authorize('forfeit.manage_promises');

        return response()->json(['data' => ForfeitPromise::with('creator:id,name')->where('pawn_ticket_id', $ticket->id)
            ->orderByDesc('id')->get()->map(fn ($p) => [
                'id' => $p->id, 'cycle_no' => $p->cycle_no, 'promise_date' => $p->promise_date->toDateString(),
                'remark' => $p->remark, 'status' => $p->status, 'overdue' => $p->isOverdue(),
                'created_by' => $p->creator?->name, 'created_at' => $p->created_at->toIso8601String(),
            ])]);
    }

    public function storePromise(Request $request, PawnTicket $ticket): JsonResponse
    {
        $this->authorize('forfeit.manage_promises');
        $d = $request->validate(['promise_date' => ['required', 'date'], 'remark' => ['nullable', 'string', 'max:1000']]);

        return response()->json(['data' => $this->forfeit->promise($ticket, $d['promise_date'], $d['remark'] ?? null)], 201);
    }

    // ---------------------------------------------------------------- queue & forfeit

    public function queue(Request $request): JsonResponse
    {
        $this->authorize('forfeit.queue');
        $d = $request->validate(['ticket_ids' => ['required', 'array', 'min:1', 'max:500'], 'ticket_ids.*' => ['integer']]);

        return response()->json(['data' => $this->forfeit->queue($d['ticket_ids'])]);
    }

    public function queued(): JsonResponse
    {
        $this->authorize('forfeit.queue');

        return response()->json(['data' => $this->forfeit->queued()->map(fn ($r) => $this->row($r['ticket']) + [
            'queued_at' => $r['ticket']->forfeit_queued_at->toIso8601String(),
            'is_blocked' => $r['ticket']->is_blocked,
        ])]);
    }

    public function unqueue(Request $request, PawnTicket $ticket): JsonResponse
    {
        $this->authorize('forfeit.queue');
        $reason = $request->validate(['reason' => ['required', 'string', 'max:500']])['reason'];
        $this->forfeit->unqueue($ticket, $reason);

        return response()->json(['data' => ['ok' => true]]);
    }

    public function execute(Request $request): JsonResponse
    {
        $this->authorize('forfeit.execute');
        $d = $request->validate(['ticket_ids' => ['required', 'array', 'min:1', 'max:200'], 'ticket_ids.*' => ['integer']]);

        return response()->json(['data' => $this->forfeit->forfeit($d['ticket_ids'])]);
    }

    // ---------------------------------------------------------------- transfer to stock

    public function awaitingTransfer(): JsonResponse
    {
        $this->authorize('forfeit.transfer_stock');

        return response()->json(['data' => $this->forfeit->awaitingTransfer()->map(fn (Forfeiture $f) => [
            'id' => $f->id, 'forfeit_no' => $f->forfeit_no, 'forfeit_date' => $f->forfeit_date->toDateString(),
            'principal_at_forfeit' => $f->principal_at_forfeit, 'interest_at_forfeit' => $f->interest_at_forfeit,
            'charges_at_forfeit' => $f->charges_at_forfeit,
            'ticket' => $this->summary($f->ticket),
            'items' => $f->ticket->items->map(fn ($i) => [
                'category' => $i->category?->name, 'article_type' => $i->articleType?->name, 'karat' => $i->karat?->name,
                'quantity' => $i->quantity, 'net_weight' => $i->net_weight,
            ]),
        ])]);
    }

    public function transfer(Request $request): JsonResponse
    {
        $this->authorize('forfeit.transfer_stock');
        $d = $request->validate([
            'forfeiture_ids' => ['required', 'array', 'min:1', 'max:200'], 'forfeiture_ids.*' => ['integer'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json(['data' => ['id' => $this->forfeit->transfer($d['forfeiture_ids'], $d['notes'] ?? null)->id]], 201);
    }

    public function batch(StockTransferBatch $batch): JsonResponse
    {
        $this->authorize('forfeit.transfer_stock');
        $batch->load(['items.category', 'items.karat', 'items.articleType', 'items.forfeiture.ticket', 'user:id,name']);

        return response()->json(['data' => [
            'company' => Company::current(),
            'batch' => [
                'batch_no' => $batch->batch_no, 'transferred_at' => $batch->transferred_at->toIso8601String(),
                'user' => $batch->user?->name, 'notes' => $batch->notes,
            ],
            'items' => $batch->items->map(fn ($i) => [
                'item_code' => $i->item_code, 'receipt_no' => $i->forfeiture?->ticket?->receipt_no,
                'category' => $i->category?->name, 'article_type' => $i->articleType?->name, 'karat' => $i->karat?->name,
                'quantity' => $i->quantity, 'net_weight' => $i->net_weight, 'cost_price' => $i->cost_price, 'sale_price' => $i->sale_price,
            ]),
        ]]);
    }

    // ---------------------------------------------------------------- helpers

    private function summary(PawnTicket $t): array
    {
        return [
            'id' => $t->id, 'receipt_no' => $t->receipt_no, 'stock_no' => $t->stock_no,
            'scheme' => $t->scheme?->code, 'maturity_date' => $t->maturity_date->toDateString(),
            'principal_current' => $t->principal_current,
            'customer' => ['name' => $t->customer?->full_name, 'nic' => $t->customer?->nic, 'phone' => $t->customer?->phone1],
        ];
    }

    private function row(PawnTicket $t): array
    {
        $s = $this->calculator->statement($t);

        return $this->summary($t) + [
            'interest' => $s->interest, 'arrears' => $s->arrearsTotal, 'total' => $s->redemptionTotal,
            'days_overdue' => max(0, (int) $t->maturity_date->diffInDays(today(), false)),
        ];
    }
}
