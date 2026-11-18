<?php

namespace App\Domain\Forfeit\Services;

use App\Domain\Accounting\Services\JournalLineData;
use App\Domain\Accounting\Services\LedgerPoster;
use App\Domain\Arrears\Services\ArrearsService;
use App\Domain\Core\Services\SequenceService;
use App\Domain\Core\Support\Money;
use App\Domain\Forfeit\Models\ForfeitPromise;
use App\Domain\Forfeit\Models\Forfeiture;
use App\Domain\Inventory\Models\InventoryItem;
use App\Domain\Inventory\Models\StockMovement;
use App\Domain\Inventory\Models\StockTransferBatch;
use App\Domain\Masters\Models\Karat;
use App\Domain\Pawning\Calculation\Dec;
use App\Domain\Pawning\Calculation\Valuation;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Models\PawnTicketEvent;
use App\Domain\Pawning\Services\TicketCalculator;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Letter 3 → forfeit reminder list (promises) → forfeit queue → forfeiture →
 * transfer of the articles to sale stock. Nothing is forfeited automatically;
 * each step is a deliberate action by an authorised user.
 */
class ForfeitService
{
    public function __construct(
        private ArrearsService $arrears,
        private TicketCalculator $calculator,
        private SequenceService $sequences,
        private LedgerPoster $ledger,
    ) {}

    // ------------------------------------------------------------- reminders

    /** Tickets whose reminder date (letter 3 + reminder days) has arrived, not yet queued. */
    public function reminders(?CarbonImmutable $today = null): Collection
    {
        $today ??= CarbonImmutable::today();

        return PawnTicket::active()
            ->with(['customer', 'scheme', 'schemeVersion', 'letters'])
            ->where('maturity_date', '<=', $today)
            ->whereNull('forfeit_queued_at')
            ->whereHas('letters', fn ($q) => $q->where('letter_no', 3)->whereColumn('cycle_no', 'pawn_tickets.letter_cycle'))
            ->orderBy('maturity_date')
            ->get()
            ->map(fn (PawnTicket $t) => ['ticket' => $t, 'schedule' => $this->arrears->schedule($t, $today)])
            ->filter(fn ($r) => $r['schedule']['reminder_due'])
            ->map(fn ($r) => $r + ['promise' => $this->currentPromise($r['ticket'])])
            ->values();
    }

    public function currentPromise(PawnTicket $t): ?ForfeitPromise
    {
        return ForfeitPromise::where('pawn_ticket_id', $t->id)->where('cycle_no', $t->letter_cycle)
            ->whereIn('status', [ForfeitPromise::PENDING, ForfeitPromise::BROKEN])
            ->orderByDesc('id')->first();
    }

    /** Record (or extend) the customer's promise to pay by a date. */
    public function promise(PawnTicket $ticket, string $date, ?string $remark): ForfeitPromise
    {
        return DB::transaction(function () use ($ticket, $date, $remark) {
            $t = PawnTicket::lockForUpdate()->findOrFail($ticket->id);
            if (! $t->isActive() || $t->forfeit_queued_at) {
                throw ValidationException::withMessages(['ticket' => 'Promises can only be recorded for active tickets that are not queued for forfeit.']);
            }
            $promiseDate = CarbonImmutable::parse($date)->startOfDay();
            if ($promiseDate->lte(today())) {
                throw ValidationException::withMessages(['promise_date' => 'The promise date must be in the future.']);
            }

            $current = ForfeitPromise::where('pawn_ticket_id', $t->id)->where('cycle_no', $t->letter_cycle)
                ->where('status', ForfeitPromise::PENDING)->lockForUpdate()->latest('id')->first();

            if ($current) {
                // Old rule: a promise can only be changed before its date arrives.
                if ($current->promise_date->lte(today())) {
                    throw ValidationException::withMessages(['promise_date' => 'The current promise date has arrived; it can no longer be extended.']);
                }
                if ($promiseDate->lte($current->promise_date)) {
                    throw ValidationException::withMessages(['promise_date' => 'An extension must be later than the current promise ('.$current->promise_date->toDateString().').']);
                }
                $current->update(['status' => ForfeitPromise::EXTENDED, 'updated_by' => auth()->id()]);
            }

            $promise = ForfeitPromise::create([
                'pawn_ticket_id' => $t->id,
                'cycle_no' => $t->letter_cycle,
                'promise_date' => $promiseDate,
                'remark' => $remark,
                'previous_promise_id' => $current?->id,
                'created_by' => auth()->id(),
                'updated_by' => auth()->id(),
            ]);
            $t->update(['arrears_stage' => 'reminder']);
            PawnTicketEvent::record($t, $current ? 'promise_extended' : 'promise_recorded',
                "Customer promised to pay by {$promiseDate->toDateString()}".($remark ? ": {$remark}" : ''));

            return $promise;
        });
    }

    // ------------------------------------------------------------- queue

    /** Move tickets to the forfeit queue. Refused while a promise is still in the future. */
    public function queue(array $ticketIds): array
    {
        $queued = [];
        $skipped = [];
        foreach (array_unique($ticketIds) as $id) {
            DB::transaction(function () use ($id, &$queued, &$skipped) {
                $t = PawnTicket::with(['scheme', 'schemeVersion', 'letters'])->lockForUpdate()->find($id);
                $reason = match (true) {
                    ! $t => 'Ticket not found in this branch.',
                    ! $t->isActive() => "Ticket is {$t->status}.",
                    $t->forfeit_queued_at !== null => 'Already queued.',
                    ! $this->arrears->schedule($t)['reminder_due'] => 'Forfeit reminder period has not ended.',
                    default => null,
                };
                $promise = $t ? ForfeitPromise::where('pawn_ticket_id', $t->id)->where('cycle_no', $t->letter_cycle)
                    ->where('status', ForfeitPromise::PENDING)->latest('id')->first() : null;
                if (! $reason && $promise && $promise->promise_date->gte(today())) {
                    $reason = 'Customer promised to pay by '.$promise->promise_date->toDateString().'.';
                }
                if ($reason) {
                    $skipped[] = ['ticket_id' => $id, 'receipt_no' => $t?->receipt_no, 'reason' => $reason];

                    return;
                }

                $promise?->update(['status' => ForfeitPromise::BROKEN, 'updated_by' => auth()->id()]);
                $t->update(['forfeit_queued_at' => now(), 'arrears_stage' => 'forfeit_queued']);
                PawnTicketEvent::record($t, 'forfeit_queued', 'Queued for forfeit');
                $queued[] = $t->id;
            });
        }

        return ['queued' => $queued, 'skipped' => $skipped];
    }

    public function unqueue(PawnTicket $ticket, string $reason): PawnTicket
    {
        return DB::transaction(function () use ($ticket, $reason) {
            $t = PawnTicket::lockForUpdate()->findOrFail($ticket->id);
            if (! $t->isActive() || ! $t->forfeit_queued_at) {
                throw ValidationException::withMessages(['ticket' => 'Ticket is not in the forfeit queue.']);
            }
            $t->update(['forfeit_queued_at' => null, 'arrears_stage' => 'reminder']);
            PawnTicketEvent::record($t, 'forfeit_unqueued', $reason);

            return $t;
        });
    }

    public function queued(): Collection
    {
        return PawnTicket::active()->with(['customer', 'scheme', 'schemeVersion', 'letters'])
            ->whereNotNull('forfeit_queued_at')->orderBy('forfeit_queued_at')->get()
            ->map(fn (PawnTicket $t) => ['ticket' => $t, 'statement' => $this->calculator->statement($t)->toArray()]);
    }

    // ------------------------------------------------------------- forfeit

    /**
     * Forfeit queued tickets. Capital moves from loans to forfeited stock;
     * unpaid interest and charges are recorded on the forfeiture but not
     * booked as income (nothing was collected).
     */
    public function forfeit(array $ticketIds): array
    {
        $done = [];
        $skipped = [];
        foreach (array_unique($ticketIds) as $id) {
            DB::transaction(function () use ($id, &$done, &$skipped) {
                $t = PawnTicket::with(['scheme', 'schemeVersion', 'letters', 'items'])->lockForUpdate()->find($id);
                $reason = match (true) {
                    ! $t => 'Ticket not found in this branch.',
                    ! $t->isActive() => "Ticket is {$t->status}.",
                    ! $t->forfeit_queued_at => 'Ticket is not in the forfeit queue.',
                    $t->is_blocked => 'Ticket is blocked.',
                    default => null,
                };
                if ($reason) {
                    $skipped[] = ['ticket_id' => $id, 'receipt_no' => $t?->receipt_no, 'reason' => $reason];

                    return;
                }

                $s = $this->calculator->statement($t);
                $forfeiture = Forfeiture::create([
                    'branch_id' => $t->branch_id,
                    'forfeit_no' => $this->sequences->next('forfeit', $t->branch_id),
                    'pawn_ticket_id' => $t->id,
                    'forfeit_date' => today(),
                    'principal_at_forfeit' => $s->principal,
                    'interest_at_forfeit' => $s->interest,
                    'charges_at_forfeit' => Money::add($s->serviceCharge, $s->letterCharge),
                    'total_due' => $s->redemptionTotal,
                    'approved_by' => auth()->id(),
                    'created_by' => auth()->id(),
                ]);

                $journal = $this->ledger->post([
                    JournalLineData::debit('forfeited_stock', $s->principal, "Forfeited articles {$t->receipt_no}", $t->id, $t->customer_id),
                    JournalLineData::credit('pawn_loans_receivable', $s->principal, "Loan closed by forfeit {$t->receipt_no}", $t->id, $t->customer_id),
                ], "Forfeit {$forfeiture->forfeit_no} of {$t->receipt_no}", today(), $forfeiture, $t->branch_id);
                $forfeiture->update(['journal_entry_id' => $journal->id]);

                $t->update([
                    'status' => PawnTicket::STATUS_FORFEITED,
                    'forfeited_at' => now(),
                    'arrears_stage' => 'none',
                    'updated_by' => auth()->id(),
                ]);
                $t->items()->update(['status' => 'forfeited']);
                PawnTicketEvent::record($t, 'forfeited', "Forfeit {$forfeiture->forfeit_no}", $s->principal,
                    ['interest' => $s->interest, 'charges' => Money::add($s->serviceCharge, $s->letterCharge)]);
                $done[] = $forfeiture->id;
            });
        }

        return ['forfeitures' => $done, 'skipped' => $skipped];
    }

    // ------------------------------------------------------------- transfer to stock

    /** Forfeitures whose articles are not yet in sale stock. */
    public function awaitingTransfer(): Collection
    {
        return Forfeiture::with(['ticket.customer', 'ticket.items.category', 'ticket.items.karat', 'ticket.items.articleType'])
            ->whereDoesntHave('inventoryItems')
            ->orderBy('forfeit_date')->get();
    }

    /**
     * Move all articles of the given forfeitures into sale stock in one batch.
     * Cost = the ticket's capital, split across articles by assessed value.
     * Sale price = today's karat sale rate ÷ 8 × net weight.
     */
    public function transfer(array $forfeitureIds, ?string $notes = null): StockTransferBatch
    {
        return DB::transaction(function () use ($forfeitureIds, $notes) {
            $forfeitures = Forfeiture::with(['ticket.items', 'ticket.branch'])->lockForUpdate()
                ->whereIn('id', array_unique($forfeitureIds))->get();
            if ($forfeitures->count() !== count(array_unique($forfeitureIds))) {
                throw ValidationException::withMessages(['forfeiture_ids' => 'Some forfeitures were not found in this branch.']);
            }
            if (InventoryItem::whereIn('forfeiture_id', $forfeitures->pluck('id'))->exists()) {
                throw ValidationException::withMessages(['forfeiture_ids' => 'Some of these articles are already in stock.']);
            }

            $branch = $forfeitures->first()->ticket->branch;
            $batch = StockTransferBatch::create([
                'branch_id' => $branch->id,
                'batch_no' => $this->sequences->next('transfer_batch', $branch->id),
                'transferred_at' => now(),
                'user_id' => auth()->id(),
                'notes' => $notes,
            ]);
            $karats = Karat::with('currentRate')->get()->keyBy('id');

            foreach ($forfeitures as $f) {
                $items = $f->ticket->items;
                $totalValue = $items->reduce(fn ($c, $i) => Dec::add($c, (string) $i->assessed_value), '0');
                $allocated = '0';
                foreach ($items->values() as $idx => $item) {
                    // Last article takes the remainder so costs add up exactly to the capital.
                    $cost = $idx === $items->count() - 1
                        ? Money::sub((string) $f->principal_at_forfeit, $allocated)
                        : Money::of(Dec::cmp($totalValue, 0) > 0
                            ? Dec::div(Dec::mul((string) $f->principal_at_forfeit, (string) $item->assessed_value), $totalValue)
                            : '0');
                    $allocated = Money::add($allocated, $cost);

                    $saleRate = (string) ($karats[$item->karat_id]?->currentRate?->sale_rate_per_8g ?? 0);
                    $seq = $this->sequences->next('inventory_item', $branch->id);
                    $inv = InventoryItem::create([
                        'branch_id' => $branch->id,
                        'item_code' => "{$branch->code}-{$seq}",
                        'barcode' => $branch->code.$seq,
                        'source' => 'forfeit',
                        'forfeiture_id' => $f->id,
                        'pawn_ticket_item_id' => $item->id,
                        'transfer_batch_id' => $batch->id,
                        'category_id' => $item->category_id,
                        'article_type_id' => $item->article_type_id,
                        'karat_id' => $item->karat_id,
                        'description' => $item->description,
                        'quantity' => $item->quantity,
                        'gross_weight' => $item->gross_weight,
                        'net_weight' => $item->net_weight,
                        'cost_price' => $cost,
                        'sale_price' => Valuation::articleValue($saleRate, (string) $item->net_weight),
                        'received_at' => now(),
                    ]);
                    StockMovement::create([
                        'inventory_item_id' => $inv->id,
                        'branch_id' => $branch->id,
                        'movement_type' => 'forfeit_in',
                        'qty_in' => $item->quantity,
                        'reference_type' => 'stock_transfer_batch',
                        'reference_id' => $batch->id,
                        'moved_at' => now(),
                        'user_id' => auth()->id(),
                    ]);
                    $item->update(['status' => 'in_stock']);
                }
                PawnTicketEvent::record($f->ticket, 'transferred_to_stock', "Articles moved to sale stock (batch {$batch->batch_no})");
            }

            return $batch->load('items');
        });
    }
}
