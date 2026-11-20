<?php

namespace App\Domain\Pawning\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Domain\Pawning\Models\PawnTicket */
class PawnTicketResource extends JsonResource
{
    public ?array $statement = null;

    public function withStatement(array $statement): static
    {
        $this->statement = $statement;

        return $this;
    }

    public function toArray(Request $request): array
    {
        $date = fn ($d) => $d?->toDateString();

        return [
            'id' => $this->id,
            'branch' => $this->whenLoaded('branch', fn () => ['id' => $this->branch->id, 'code' => $this->branch->code, 'name' => $this->branch->name]),
            'receipt_no' => $this->receipt_no,
            'ticket_no' => $this->ticket_no,
            'stock_no' => $this->stock_no,
            'legacy_receipt_no' => $this->legacy_receipt_no,
            'is_opening' => $this->is_opening,
            'status' => $this->status,
            'arrears_stage' => $this->arrears_stage,
            'is_blocked' => $this->is_blocked,
            'block_reason' => $this->block_reason,
            'pawn_date' => $date($this->pawn_date),
            'cycle_start_date' => $date($this->cycle_start_date),
            'maturity_date' => $date($this->maturity_date),
            'is_overdue' => $this->status === 'active' && $this->maturity_date?->isPast() && ! $this->maturity_date->isToday(),
            'valid_months' => $this->valid_months,
            'gross_weight' => $this->gross_weight,
            'net_weight' => $this->net_weight,
            'assessed_value' => $this->assessed_value,
            'market_value' => $this->market_value,
            'principal_original' => $this->principal_original,
            'principal_current' => $this->principal_current,
            'monthly_interest_rate' => $this->monthly_interest_rate,
            'scheme' => $this->whenLoaded('scheme', fn () => ['id' => $this->scheme->id, 'code' => $this->scheme->code, 'name' => $this->scheme->name, 'interest_method' => $this->scheme->interest_method]),
            'scheme_version' => $this->whenLoaded('schemeVersion'),
            'customer' => $this->whenLoaded('customer', fn () => [
                'id' => $this->customer->id, 'code' => $this->customer->code, 'title' => $this->customer->title,
                'full_name' => $this->customer->full_name, 'nic' => $this->customer->nic, 'phone1' => $this->customer->phone1,
                'address' => trim(implode(', ', array_filter([$this->customer->address_line1, $this->customer->address_line2, $this->customer->city]))),
            ]),
            'items' => $this->whenLoaded('items', fn () => $this->items->map(fn ($i) => [
                'id' => $i->id,
                'category' => $i->category?->name,
                'article_type' => $i->articleType?->name,
                'condition' => $i->condition?->name,
                'karat' => $i->karat?->name,
                'description' => $i->description,
                'quantity' => $i->quantity,
                'gross_weight' => $i->gross_weight,
                'net_weight' => $i->net_weight,
                'density_reading' => $i->density_reading,
                'karat_rate_per_8g' => $i->karat_rate_per_8g,
                'assessed_value' => $i->assessed_value,
                'status' => $i->status,
            ])),
            'transactions' => $this->whenLoaded('transactions', fn () => $this->transactions->map(fn ($t) => [
                'id' => $t->id, 'txn_no' => $t->txn_no, 'type' => $t->type, 'txn_at' => $t->txn_at->toIso8601String(),
                'interest_days' => $t->interest_days, 'principal_before' => $t->principal_before,
                'interest_due' => $t->interest_due, 'interest_paid' => $t->interest_paid, 'interest_capitalised' => $t->interest_capitalised,
                'service_charge' => $t->service_charge, 'postage_charge' => $t->postage_charge, 'stamp_duty' => $t->stamp_duty,
                'discount' => $t->discount, 'principal_paid' => $t->principal_paid, 'principal_added' => $t->principal_added,
                'principal_after' => $t->principal_after, 'cash_received' => $t->cash_received, 'cash_paid' => $t->cash_paid,
                'new_maturity_date' => $t->new_maturity_date?->toDateString(), 'remarks' => $t->remarks,
                'created_by' => $t->creator?->name,
            ])),
            'events' => $this->whenLoaded('events', fn () => $this->events->map(fn ($e) => [
                'type' => $e->event_type, 'at' => $e->event_at->toIso8601String(), 'description' => $e->description,
                'amount' => $e->amount, 'user' => $e->user?->name,
            ])),
            'letters' => $this->whenLoaded('letters', fn () => $this->letters->map(fn ($l) => [
                'cycle_no' => $l->cycle_no, 'letter_no' => $l->letter_no, 'due_date' => $l->due_date->toDateString(),
                'issued_at' => $l->issued_at->toIso8601String(), 'postage_charge' => $l->postage_charge,
            ])),
            'statement' => $this->when($this->statement !== null, fn () => $this->statement),
            'created_by' => $this->whenLoaded('creator', fn () => $this->creator?->name),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
