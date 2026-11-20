<?php

use App\Domain\Customers\Models\Customer;
use App\Domain\Masters\Models\ArticleCategory;
use App\Domain\Masters\Models\Karat;
use App\Domain\Pawning\Models\PawnTicket;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/*
 * End-to-end pawning through the API. Karat B4 = Rs. 340,000 per 8 g, so
 * 8 g net is worth exactly Rs. 340,000. Scheme A: 1% ≤10 d, 2% ≤15 d, 2.5%/month.
 */

beforeEach(function () {
    Carbon::setTestNow('2026-11-01 10:00:00');
    $this->cashier = userWithRole('branch_manager');   // has pawn.* incl. discount, cancel, block
    $this->customer = Customer::create([
        'branch_id' => branch()->id, 'code' => 'C001TEST', 'first_name' => 'Nimal', 'last_name' => 'Perera',
        'nic' => '901234567V', 'address_line1' => 'No 5', 'phone1' => '0771234567',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

it('quotes value, scheme and term table from today\'s rates', function () {
    $q = api_('POST', '/pawn-tickets/quote', ['items' => [item()], 'amount' => 40000])->assertOk()->json('data');

    expect($q['assessed_value'])->toBe('340000.00')
        ->and($q['scheme']['code'])->toBe('A')
        ->and($q['term_capacities'][1])->toBe('340000.00')
        ->and($q['term_capacities'][2])->toBe('331500.00')   // − 2.5% of value per extra month
        ->and($q['max_term'])->toBe(12);

    expect(api_('POST', '/pawn-tickets/quote', ['items' => [item()], 'amount' => 150000])->json('data.scheme.code'))->toBe('C');
});

it('creates a pawn: numbers, maturity, cash journal', function () {
    $t = pawn(40000, 3);

    expect($t['receipt_no'])->toBe('000001')
        ->and($t['stock_no'])->toBe('000001')
        ->and($t['scheme']['code'])->toBe('A')
        ->and($t['maturity_date'])->toBe('2027-02-01')
        ->and($t['principal_current'])->toBe('40000.00')
        ->and($t['statement']['interest'])->toBe('400.00')      // day 1 = 1%
        ->and($t['items'])->toHaveCount(1);

    expect(ticketBalance($t['id'], 'pawn_loans_receivable'))->toBe('40000.00')
        ->and(ticketBalance($t['id'], 'cash'))->toBe('-40000.00');
    assertLedgerBalanced();
});

it('saves the optional density meter reading per item without changing the value', function () {
    $t = pawn(40000, 3, [item(['density_reading' => '17.85']), item()]);

    expect($t['items'][0]['density_reading'])->toBe('17.850')
        ->and($t['items'][1]['density_reading'])->toBeNull()
        ->and($t['assessed_value'])->toBe('680000.00');   // 2 × 340,000 — the reading does not affect value

    expect(api_('GET', "/pawn-tickets/{$t['id']}")->json('data.items.0.density_reading'))->toBe('17.850');

    api_('POST', '/pawn-tickets', ['customer_id' => $this->customer->id, 'items' => [item(['density_reading' => -1])], 'amount' => 40000, 'months' => 3])
        ->assertStatus(422)->assertJsonValidationErrors('items.0.density_reading');
});

it('rejects loans above the value, too-long terms and customers over their limit', function () {
    api_('POST', '/pawn-tickets', ['customer_id' => $this->customer->id, 'items' => [item()], 'amount' => 340001, 'months' => 1])
        ->assertStatus(422)->assertJsonValidationErrors('amount');

    // 330,000 is only covered for 2 months (capacity 331,500).
    api_('POST', '/pawn-tickets', ['customer_id' => $this->customer->id, 'items' => [item()], 'amount' => 330000, 'months' => 3])
        ->assertStatus(422)->assertJsonPath('errors.months.0', 'For this loan the term can be 1 to 2 months.');

    $this->customer->update(['pawn_amount_limit' => 30000]);
    api_('POST', '/pawn-tickets', ['customer_id' => $this->customer->id, 'items' => [item()], 'amount' => 40000, 'months' => 1])
        ->assertStatus(422)->assertJsonValidationErrors('amount');
});

it('puts any silver article on the Silver scheme', function () {
    $t = pawn(2000, 1, [item(['karat_id' => Karat::where('code', 'SILVER')->value('id'), 'gross_weight' => 10, 'net_weight' => 10])]);

    expect($t['scheme']['code'])->toBe('SILVER')
        ->and($t['maturity_date'])->toBe('2026-12-01');   // 30 valid days from 1 Nov
});

it('takes a part payment: interest first, new cycle tomorrow, balanced journal', function () {
    $t = pawn(40000, 3);
    Carbon::setTestNow('2026-11-20 11:00:00');   // day 20 → 2.5% = 1,000

    $q = api_('GET', "/pawn-tickets/{$t['id']}/part-payment/quote?amount=11000&months=3")->assertOk()->json('data');
    expect($q['statement']['interest'])->toBe('1000.00')
        ->and($q['allocation']['principalPaid'])->toBe('10000.00')
        ->and($q['allocation']['newPrincipal'])->toBe('30000.00')
        ->and($q['new_cycle_start'])->toBe('2026-11-21');

    api_('POST', "/pawn-tickets/{$t['id']}/part-payment", ['amount' => 11000, 'months' => 3])->assertCreated();

    $ticket = PawnTicket::find($t['id']);
    expect((string) $ticket->principal_current)->toBe('30000.00')
        ->and($ticket->cycle_start_date->toDateString())->toBe('2026-11-21')
        ->and($ticket->maturity_date->toDateString())->toBe('2027-02-20');

    // Same day again: no new interest.
    expect(api_('GET', "/pawn-tickets/{$t['id']}")->json('data.statement.interest'))->toBe('0.00');

    expect(ticketBalance($t['id'], 'pawn_loans_receivable'))->toBe('30000.00')
        ->and(ticketBalance($t['id'], 'interest_income'))->toBe('-1000.00');
    assertLedgerBalanced();
});

it('refuses a part payment that clears the ticket or leaves under Rs. 1,000', function () {
    $t = pawn(40000, 3);

    api_('POST', "/pawn-tickets/{$t['id']}/part-payment", ['amount' => 40400, 'months' => 1])
        ->assertStatus(422)->assertJsonPath('errors.amount.0', 'This pays the full redemption amount. Use Redemption instead.');
    api_('POST', "/pawn-tickets/{$t['id']}/part-payment", ['amount' => 39500, 'months' => 1])
        ->assertStatus(422)->assertJsonValidationErrors('amount');
});

it('renews: capitalises what is owed, pays extra cash, re-bands the scheme', function () {
    $t = pawn(40000, 3);
    Carbon::setTestNow('2026-12-01 09:00:00');   // day 31: 2.5% + 2.5/30 → 1,033.33

    $q = api_('GET', "/pawn-tickets/{$t['id']}/renewal/quote?extra_cash=20000&months=6")->assertOk()->json('data');
    expect($q['statement']['interest'])->toBe('1033.33')
        ->and($q['statement']['service_charge'])->toBe('60.00')
        ->and($q['new_principal'])->toBe('61093.33')            // 40,000 + 20,000 + 1,033.33 + 60
        ->and($q['new_scheme'])->toBe('B');

    api_('POST', "/pawn-tickets/{$t['id']}/renewal", ['extra_cash' => 20000, 'months' => 6])->assertCreated();

    $ticket = PawnTicket::with('scheme')->find($t['id']);
    expect((string) $ticket->principal_current)->toBe('61093.33')
        ->and($ticket->scheme->code)->toBe('B')
        ->and($ticket->letter_cycle)->toBe(2)
        ->and($ticket->maturity_date->toDateString())->toBe('2027-06-01');

    expect(ticketBalance($t['id'], 'pawn_loans_receivable'))->toBe('61093.33')
        ->and(ticketBalance($t['id'], 'cash'))->toBe('-60000.00');
    assertLedgerBalanced();
});

it('rejects extra cash the articles do not cover', function () {
    $t = pawn(300000, 1);

    api_('POST', "/pawn-tickets/{$t['id']}/renewal", ['extra_cash' => 50000, 'months' => 1])
        ->assertStatus(422)->assertJsonValidationErrors('extra_cash');
});

it('redeems with discount and cash rounding, closing the ticket and its loan balance', function () {
    $t = pawn(40000, 3);
    Carbon::setTestNow('2026-11-05 15:00:00');   // day 5 → 1% = 400; service 60

    $q = api_('GET', "/pawn-tickets/{$t['id']}/redemption/quote?discount=10")->assertOk()->json('data');
    expect($q['totals']['payable'])->toBe('40450.00');           // 40,000 + 400 + 60 − 10

    api_('POST', "/pawn-tickets/{$t['id']}/redemption", ['discount' => 10, 'cash_received' => '40448'])->assertCreated();

    $ticket = PawnTicket::find($t['id']);
    expect($ticket->status)->toBe('redeemed')
        ->and($ticket->items()->pluck('status')->unique()->all())->toBe(['redeemed'])
        ->and(ticketBalance($t['id'], 'pawn_loans_receivable'))->toBe('0.00')
        ->and(ticketBalance($t['id'], 'rounding'))->toBe('2.00')
        ->and(ticketBalance($t['id'], 'cash'))->toBe('448.00');  // −40,000 out, +40,448 in
    assertLedgerBalanced();

    api_('POST', "/pawn-tickets/{$t['id']}/redemption", [])->assertStatus(422);   // already redeemed
});

it('rejects cash more than Rs. 5 away from the payable amount', function () {
    $t = pawn(40000, 3);

    api_('POST', "/pawn-tickets/{$t['id']}/redemption", ['cash_received' => 40000])
        ->assertStatus(422)->assertJsonValidationErrors('cash_received');
});

it('blocks redeem and renew on a blocked ticket but allows part payment', function () {
    $t = pawn(40000, 3);
    api_('PUT', "/pawn-tickets/{$t['id']}/block", ['blocked' => true], userWithRole('cashier'))->assertForbidden();
    api_('PUT', "/pawn-tickets/{$t['id']}/block", ['blocked' => true, 'reason' => 'Police inquiry'])->assertOk();

    api_('POST', "/pawn-tickets/{$t['id']}/redemption", [])->assertStatus(422)->assertJsonPath('errors.ticket.0', fn ($m) => str_contains($m, 'blocked'));
    api_('POST', "/pawn-tickets/{$t['id']}/renewal", ['months' => 1])->assertStatus(422);
    api_('POST', "/pawn-tickets/{$t['id']}/part-payment", ['amount' => 5000, 'months' => 3])->assertCreated();
});

it('cancels a pawn the same day by reversing its journal', function () {
    $t = pawn(40000, 3);
    api_('POST', "/pawn-tickets/{$t['id']}/cancel", ['reason' => 'Wrong customer'])->assertOk()->assertJsonPath('data.status', 'cancelled');

    expect(ticketBalance($t['id'], 'pawn_loans_receivable'))->toBe('0.00')
        ->and(ticketBalance($t['id'], 'cash'))->toBe('0.00');
    assertLedgerBalanced();

    $t2 = pawn(40000, 3);
    Carbon::setTestNow('2026-11-02 09:00:00');
    api_('POST', "/pawn-tickets/{$t2['id']}/cancel", ['reason' => 'Late'])->assertStatus(422);
});

it('needs the discount permission to give a discount', function () {
    $t = pawn(40000, 3);

    api_('GET', "/pawn-tickets/{$t['id']}/redemption/quote")->assertOk();
    api_('POST', "/pawn-tickets/{$t['id']}/redemption", ['discount' => 10], userWithRole('cashier'))
        ->assertStatus(422)->assertJsonValidationErrors('discount');
});

it('keeps tickets inside their branch', function () {
    $t = pawn(40000, 3);

    api_('GET', "/pawn-tickets/{$t['id']}", [], userWithRole('cashier', '002'))->assertNotFound();
    api_('POST', "/pawn-tickets/{$t['id']}/redemption", [], userWithRole('cashier', '002'))->assertNotFound();
    expect(api_('GET', '/pawn-tickets', [], userWithRole('cashier', '002'))->json('data'))->toBe([]);
});

it('enters an opening ticket against the head office account, not cash', function () {
    $t = api_('POST', '/pawn-tickets/opening', [
        'customer_id' => $this->customer->id, 'items' => [item()], 'principal' => 25000,
        'pawn_date' => '2026-08-15', 'months' => 6, 'legacy_receipt_no' => 'OLD-7828',
    ])->assertCreated()->json('data');

    expect($t['is_opening'])->toBeTrue()
        ->and($t['pawn_date'])->toBe('2026-08-15')
        ->and($t['maturity_date'])->toBe('2027-02-15')
        ->and(ticketBalance($t['id'], 'cash'))->toBe('0.00')
        ->and(ticketBalance($t['id'], 'head_office_current'))->toBe('-25000.00');

    api_('POST', '/pawn-tickets/opening', [
        'customer_id' => $this->customer->id, 'items' => [item()], 'principal' => 25000,
        'pawn_date' => '2026-08-15', 'months' => 6, 'legacy_receipt_no' => 'OLD-7828',
    ])->assertStatus(422)->assertJsonValidationErrors('legacy_receipt_no');
});

it('finds tickets by number or customer and lists a customer\'s tickets', function () {
    $t = pawn(40000, 3);

    expect(api_('GET', '/pawn-tickets?q=000001')->json('data.0.id'))->toBe($t['id'])
        ->and(api_('GET', '/pawn-tickets?q=Nimal')->json('data.0.id'))->toBe($t['id'])
        ->and(api_('GET', "/customers/{$this->customer->id}/tickets")->json('data'))->toHaveCount(1);
});
