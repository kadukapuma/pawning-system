<?php

namespace App\Domain\Sales\Services;

use App\Domain\Accounting\Models\JournalEntry;
use App\Domain\Accounting\Services\JournalLineData;
use App\Domain\Accounting\Services\LedgerPoster;
use App\Domain\Core\Services\SequenceService;
use App\Domain\Core\Support\BranchContext;
use App\Domain\Core\Support\Money;
use App\Domain\Customers\Models\Customer;
use App\Domain\Inventory\Models\InventoryItem;
use App\Domain\Inventory\Models\StockMovement;
use App\Domain\Pawning\Models\PawnTicketItem;
use App\Domain\Sales\Models\SalesInvoice;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Sale of forfeited articles (old InvoiceController). Each stock item is sold
 * whole and only once. Journals:
 *   Dr cash / card receivable      Cr sales income        (net amount)
 *   Dr cost of sales               Cr forfeited stock     (cost)
 */
class SalesService
{
    public function __construct(
        private SequenceService $sequences,
        private LedgerPoster $ledger,
        private BranchContext $branch,
    ) {}

    /**
     * @param  array{lines: list<array{inventory_item_id:int, unit_price:string|float, discount?:string|float}>,
     *               customer_id?:?int, customer_name?:?string, customer_phone?:?string,
     *               paid_cash?:string|float, paid_card?:string|float}  $data
     */
    public function create(array $data): SalesInvoice
    {
        return DB::transaction(function () use ($data) {
            $ids = array_column($data['lines'], 'inventory_item_id');
            if (count($ids) !== count(array_unique($ids))) {
                throw ValidationException::withMessages(['lines' => 'An item is listed twice.']);
            }
            $items = InventoryItem::lockForUpdate()->whereIn('id', $ids)->get()->keyBy('id');

            $gross = $discount = $cost = '0.00';
            $lines = [];
            foreach ($data['lines'] as $i => $line) {
                $item = $items[$line['inventory_item_id']] ?? null;
                if (! $item) {
                    throw ValidationException::withMessages(["lines.{$i}.inventory_item_id" => 'Item not found in this branch.']);
                }
                if ($item->status !== InventoryItem::IN_STOCK) {
                    throw ValidationException::withMessages(["lines.{$i}.inventory_item_id" => "Item {$item->item_code} is {$item->status}."]);
                }
                $price = Money::of($line['unit_price']);
                $lineDiscount = Money::of($line['discount'] ?? 0);
                if (! Money::isPositive($price) || Money::compare($lineDiscount, $price) > 0) {
                    throw ValidationException::withMessages(["lines.{$i}.unit_price" => 'Enter a price above zero, with a discount no larger than the price.']);
                }
                if (Money::isPositive($lineDiscount) && ! auth()->user()?->can('pawn.discount')) {
                    throw ValidationException::withMessages(["lines.{$i}.discount" => 'You are not allowed to give discounts.']);
                }
                $lines[] = [
                    'item' => $item,
                    'unit_price' => $price,
                    'discount' => $lineDiscount,
                    'line_total' => Money::sub($price, $lineDiscount),
                ];
                $gross = Money::add($gross, $price);
                $discount = Money::add($discount, $lineDiscount);
                $cost = Money::add($cost, (string) $item->cost_price);
            }
            $net = Money::sub($gross, $discount);

            $cash = Money::of($data['paid_cash'] ?? 0);
            $card = Money::of($data['paid_card'] ?? 0);
            if (Money::isNegative($cash) || Money::isNegative($card) || Money::compare(Money::add($cash, $card), $net) !== 0) {
                throw ValidationException::withMessages([
                    'paid_cash' => 'Cash + card must equal the invoice total of Rs. '.number_format((float) $net, 2).'.',
                ]);
            }

            $customer = isset($data['customer_id']) ? Customer::find($data['customer_id']) : null;
            $branchId = $this->branch->requireId();

            $invoice = SalesInvoice::create([
                'branch_id' => $branchId,
                'invoice_no' => $this->sequences->next('sales_invoice', $branchId),
                'invoice_date' => now(),
                'customer_id' => $customer?->id,
                'customer_name' => $customer?->full_name ?? ($data['customer_name'] ?? null),
                'customer_phone' => $customer?->phone1 ?? ($data['customer_phone'] ?? null),
                'gross_amount' => $gross,
                'discount' => $discount,
                'net_amount' => $net,
                'paid_cash' => $cash,
                'paid_card' => $card,
                'created_by' => auth()->id(),
            ]);

            foreach ($lines as $l) {
                $invoice->lines()->create([
                    'inventory_item_id' => $l['item']->id,
                    'description' => $l['item']->description,
                    'qty' => $l['item']->quantity,
                    'unit_price' => $l['unit_price'],
                    'discount' => $l['discount'],
                    'line_total' => $l['line_total'],
                ]);
                $l['item']->update(['status' => InventoryItem::SOLD, 'sold_at' => now()]);
                $this->movement($l['item'], 'sale', 0, $l['item']->quantity, $invoice->id);
                if ($l['item']->pawn_ticket_item_id) {
                    PawnTicketItem::whereKey($l['item']->pawn_ticket_item_id)->update(['status' => 'sold']);
                }
            }

            $journal = $this->ledger->post([
                JournalLineData::debit('cash', $cash, 'Cash sale', null, $customer?->id),
                JournalLineData::debit('card_receivable', $card, 'Card sale', null, $customer?->id),
                JournalLineData::credit('sales_income', $net, "Sale {$invoice->invoice_no}", null, $customer?->id),
                JournalLineData::debit('cost_of_sales', $cost, 'Cost of articles sold'),
                JournalLineData::credit('forfeited_stock', $cost, 'Articles out of stock'),
            ], "Sales invoice {$invoice->invoice_no}", today(), $invoice, $branchId);
            $invoice->update(['journal_entry_id' => $journal->id]);

            return $invoice;
        });
    }

    /** Cancel a sale: reverse its journal and return the items to stock. */
    public function void(SalesInvoice $invoice, string $reason): SalesInvoice
    {
        return DB::transaction(function () use ($invoice, $reason) {
            $invoice = SalesInvoice::with('lines.item')->lockForUpdate()->findOrFail($invoice->id);
            if ($invoice->status !== SalesInvoice::COMPLETED) {
                throw ValidationException::withMessages(['invoice' => 'This invoice is already voided.']);
            }

            $this->ledger->reverse(JournalEntry::withoutBranchScope()->findOrFail($invoice->journal_entry_id), $reason);

            foreach ($invoice->lines as $line) {
                $line->item->update(['status' => InventoryItem::IN_STOCK, 'sold_at' => null]);
                $this->movement($line->item, 'return', $line->item->quantity, 0, $invoice->id);
                if ($line->item->pawn_ticket_item_id) {
                    PawnTicketItem::whereKey($line->item->pawn_ticket_item_id)->update(['status' => 'in_stock']);
                }
            }

            $invoice->update([
                'status' => SalesInvoice::VOIDED,
                'voided_by' => auth()->id(),
                'voided_at' => now(),
                'void_reason' => $reason,
            ]);

            return $invoice;
        });
    }

    private function movement(InventoryItem $item, string $type, int|string $in, int|string $out, int $invoiceId): void
    {
        StockMovement::create([
            'inventory_item_id' => $item->id,
            'branch_id' => $item->branch_id,
            'movement_type' => $type,
            'qty_in' => $in,
            'qty_out' => $out,
            'reference_type' => 'sales_invoice',
            'reference_id' => $invoiceId,
            'moved_at' => now(),
            'user_id' => auth()->id(),
        ]);
    }
}
