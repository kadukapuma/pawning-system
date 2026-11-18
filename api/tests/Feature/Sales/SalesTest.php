<?php

use App\Domain\Inventory\Models\InventoryItem;
use App\Domain\Masters\Models\ArticleCategory;
use App\Domain\Masters\Models\Karat;
use App\Domain\Sales\Models\SalesInvoice;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->cashier = userWithRole('cashier');
    $this->manager = userWithRole('branch_manager');
});

function stockItem(string $code, float $cost = 30000, float $sale = 45000, string $branch = '001'): InventoryItem
{
    $b = branch($branch);

    return InventoryItem::withoutBranchScope()->create([
        'branch_id' => $b->id, 'item_code' => $code, 'barcode' => str_replace('-', '', $code), 'source' => 'forfeit',
        'category_id' => ArticleCategory::where('name', 'Chain')->value('id'),
        'karat_id' => Karat::where('code', 'B4')->value('id'),
        'quantity' => 1, 'gross_weight' => 8.5, 'net_weight' => 8, 'cost_price' => $cost, 'sale_price' => $sale,
        'received_at' => now(),
    ]);
}

/** Balance (debit − credit) of a system account across the ledger. */
function accountBalance(string $key): string
{
    return (string) DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')
        ->where('a.system_key', $key)->selectRaw('COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS b')->value('b');
}

it('lists stock with totals and finds an item by code', function () {
    stockItem('001-IT000001');
    stockItem('001-IT000002', 10000, 15000);

    api_('GET', '/inventory', [], $this->cashier)->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.totals.items', 2)
        ->assertJsonPath('meta.totals.sale', '60000.00');

    api_('GET', '/inventory/code/001IT000002', [], $this->cashier)->assertOk()->assertJsonPath('data.item_code', '001-IT000002');
    api_('GET', '/inventory/code/NOPE', [], $this->cashier)->assertNotFound();
});

it('sells items: revenue, cost of sales and stock all posted', function () {
    $a = stockItem('001-IT000001', 30000, 45000);
    $b = stockItem('001-IT000002', 10000, 15000);

    $inv = api_('POST', '/sales', [
        'lines' => [
            ['inventory_item_id' => $a->id, 'unit_price' => 45000],
            ['inventory_item_id' => $b->id, 'unit_price' => 15000],
        ],
        'customer_name' => 'Walk-in', 'paid_cash' => 50000, 'paid_card' => 10000,
    ], $this->cashier)->assertCreated()->json('data');

    expect($inv['invoice_no'])->toBe('INV000001')
        ->and($inv['net_amount'])->toBe('60000.00')
        ->and($a->fresh()->status)->toBe('sold')
        ->and(accountBalance('sales_income'))->toBe('-60000.00')
        ->and(accountBalance('cost_of_sales'))->toBe('40000.00')
        ->and(accountBalance('forfeited_stock'))->toBe('-40000.00')
        ->and(accountBalance('cash'))->toBe('50000.00')
        ->and(accountBalance('card_receivable'))->toBe('10000.00');
    assertLedgerBalanced();
});

it('never sells the same item twice', function () {
    $a = stockItem('001-IT000001');
    $body = ['lines' => [['inventory_item_id' => $a->id, 'unit_price' => 45000]], 'paid_cash' => 45000];

    api_('POST', '/sales', $body, $this->cashier)->assertCreated();
    api_('POST', '/sales', $body, $this->cashier)->assertStatus(422)->assertJsonPath('errors', fn ($e) => str_contains(json_encode($e), 'is sold'));
});

it('requires payments to equal the total and discounts to be permitted', function () {
    $a = stockItem('001-IT000001');

    api_('POST', '/sales', ['lines' => [['inventory_item_id' => $a->id, 'unit_price' => 45000]], 'paid_cash' => 40000], $this->cashier)
        ->assertStatus(422)->assertJsonValidationErrors('paid_cash');
    api_('POST', '/sales', ['lines' => [['inventory_item_id' => $a->id, 'unit_price' => 45000, 'discount' => 1000]], 'paid_cash' => 44000], $this->cashier)
        ->assertStatus(422)->assertJsonValidationErrors('lines.0.discount');
    api_('POST', '/sales', ['lines' => [['inventory_item_id' => $a->id, 'unit_price' => 45000, 'discount' => 1000]], 'paid_cash' => 44000], $this->manager)
        ->assertCreated()->assertJsonPath('data.discount', '1000.00');
});

it('voids a sale: journals reversed, items back in stock', function () {
    $a = stockItem('001-IT000001');
    $id = api_('POST', '/sales', ['lines' => [['inventory_item_id' => $a->id, 'unit_price' => 45000]], 'paid_cash' => 45000], $this->cashier)->json('data.id');

    api_('POST', "/sales/{$id}/void", ['reason' => 'Customer returned'], $this->cashier)->assertForbidden();
    api_('POST', "/sales/{$id}/void", ['reason' => 'Customer returned'], $this->manager)->assertOk()->assertJsonPath('data.status', 'voided');

    expect($a->fresh()->status)->toBe('in_stock')
        ->and(accountBalance('sales_income'))->toBe('0.00')
        ->and(accountBalance('forfeited_stock'))->toBe('0.00');
    assertLedgerBalanced();

    api_('POST', "/sales/{$id}/void", ['reason' => 'again'], $this->manager)->assertStatus(422);
});

it('keeps stock and invoices inside their branch', function () {
    $other = stockItem('002-IT000001', 1000, 2000, '002');

    api_('POST', '/sales', ['lines' => [['inventory_item_id' => $other->id, 'unit_price' => 2000]], 'paid_cash' => 2000], $this->cashier)
        ->assertStatus(422);
    expect(api_('GET', '/inventory', [], $this->cashier)->json('data'))->toBe([]);
});

it('lets a manager re-price an item in stock', function () {
    $a = stockItem('001-IT000001');

    api_('PUT', "/inventory/{$a->id}/price", ['sale_price' => 47000], $this->cashier)->assertForbidden();
    api_('PUT', "/inventory/{$a->id}/price", ['sale_price' => 47000], $this->manager)->assertOk()->assertJsonPath('data.sale_price', '47000.00');
});

it('returns an invoice with lines for printing', function () {
    $a = stockItem('001-IT000001');
    $id = api_('POST', '/sales', ['lines' => [['inventory_item_id' => $a->id, 'unit_price' => 45000]], 'paid_cash' => 45000], $this->cashier)->json('data.id');

    api_('GET', "/sales/{$id}", [], $this->cashier)->assertOk()
        ->assertJsonPath('data.invoice.lines.0.item.item_code', '001-IT000001')
        ->assertJsonPath('data.company.name', 'Sampath Pawning Center');
    expect(SalesInvoice::count())->toBe(1);
});
