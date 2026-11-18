<?php

use App\Domain\Customers\Models\Customer;
use App\Domain\Forfeit\Models\ForfeitPromise;
use App\Domain\Inventory\Models\InventoryItem;
use App\Domain\Pawning\Models\ArrearsLetter;
use App\Domain\Pawning\Models\PawnTicket;
use Carbon\Carbon;

/*
 * Arrears → reminder → promise → queue → forfeit → stock, through the API.
 * Scheme A (seeded): letters 2 and 3 after 14 days, reminder 14 days after
 * letter 3, postage Rs. 150. Pawn on 1 Nov for 1 month → matures 1 Dec.
 */

beforeEach(function () {
    Carbon::setTestNow('2026-11-01 10:00:00');
    $this->cashier = userWithRole('branch_manager');
    $this->customer = Customer::create([
        'branch_id' => branch()->id, 'code' => 'C001ARR', 'first_name' => 'Kamal', 'last_name' => 'Silva',
        'nic' => '851112223V', 'address_line1' => 'No 9', 'phone1' => '0719998887',
    ]);
    $this->ticket = pawn(40000, 1);
});

afterEach(fn () => Carbon::setTestNow());

function at(string $date): void
{
    Carbon::setTestNow($date.' 10:00:00');
}

function dueIds(int $letter): array
{
    return collect(api_('GET', "/arrears/letters/due?letter={$letter}")->assertOk()->json('data'))->pluck('id')->all();
}

function issue(int $letter, array $ids)
{
    return api_('POST', '/arrears/letters/issue', ['letter_no' => $letter, 'ticket_ids' => $ids])->assertOk()->json('data');
}

it('lists letter 1 from the maturity date and charges postage once', function () {
    $id = $this->ticket['id'];
    at('2026-11-30');
    expect(dueIds(1))->toBe([]);

    at('2026-12-01');
    expect(dueIds(1))->toBe([$id]);

    $first = issue(1, [$id]);
    $again = issue(1, [$id]);                      // retry / double click
    expect($first['letter_ids'])->toHaveCount(1)
        ->and($again['letter_ids'])->toBe($first['letter_ids'])
        ->and(ArrearsLetter::count())->toBe(1)
        ->and(PawnTicket::find($id)->arrears_stage)->toBe('letter_1')
        ->and(api_('GET', "/pawn-tickets/{$id}")->json('data.statement.letter_charge'))->toBe('150.00')
        ->and(dueIds(1))->toBe([]);
});

it('spaces letters 2 and 3 from the actual print of the previous letter', function () {
    $id = $this->ticket['id'];
    at('2026-12-05');                               // letter 1 printed 4 days late
    issue(1, [$id]);

    at('2026-12-18');
    $early = issue(2, [$id]);
    expect($early['letter_ids'])->toBe([])
        ->and($early['skipped'][0]['reason'])->toContain('2026-12-19');

    at('2026-12-19');
    expect(dueIds(2))->toBe([$id]);
    issue(2, [$id]);
    expect(issue(3, [$id])['letter_ids'])->toBe([]);

    at('2027-01-02');
    issue(3, [$id]);
    expect(api_('GET', "/pawn-tickets/{$id}")->json('data.statement.letter_charge'))->toBe('450.00');
});

it('prints letters with the amounts owed and counts reprints without charging again', function () {
    $id = $this->ticket['id'];
    at('2026-12-01');
    $letterIds = issue(1, [$id])['letter_ids'];

    $data = api_('POST', '/arrears/letters/print', ['letter_ids' => $letterIds])->assertOk()->json('data.letters.0');
    expect($data['capital'])->toBe('40000.00')
        ->and($data['letter_charge'])->toBe('150.00')
        ->and($data['customer']['name'])->toBe('Kamal Silva');

    api_('POST', '/arrears/letters/print', ['letter_ids' => $letterIds, 'reprint' => true])->assertOk();
    expect(ArrearsLetter::first()->reprint_count)->toBe(1)
        ->and((string) ArrearsLetter::first()->postage_charge)->toBe('150.00');
});

it('starts a new letter cycle and keeps the promise when the customer pays', function () {
    $id = $this->ticket['id'];
    at('2026-12-01');
    issue(1, [$id]);

    api_('POST', "/pawn-tickets/{$id}/part-payment", ['amount' => 5000, 'months' => 1])->assertCreated();
    $t = PawnTicket::find($id);
    expect($t->letter_cycle)->toBe(2)
        ->and($t->arrears_stage)->toBe('none')
        ->and(api_('GET', "/pawn-tickets/{$id}")->json('data.statement.letter_charge'))->toBe('0.00');   // postage collected

    expect(dueIds(1))->toBe([]);                     // new maturity is 1 Jan
    at('2027-01-01');
    expect(dueIds(1))->toBe([$id]);
});

/** Bring the ticket to the reminder stage: letters on 1, 15 and 29 Dec → reminder due 12 Jan. */
function toReminder(int $id): void
{
    at('2026-12-01'); issue(1, [$id]);
    at('2026-12-15'); issue(2, [$id]);
    at('2026-12-29'); issue(3, [$id]);
}

it('puts a ticket on the reminder list 14 days after letter 3', function () {
    $id = $this->ticket['id'];
    toReminder($id);

    at('2027-01-11');
    expect(api_('GET', '/forfeit/reminders')->json('data'))->toBe([]);
    at('2027-01-12');
    expect(collect(api_('GET', '/forfeit/reminders')->json('data'))->pluck('id')->all())->toBe([$id]);
});

it('respects promises: no queueing before the date, extensions only before it arrives', function () {
    $id = $this->ticket['id'];
    toReminder($id);
    at('2027-01-12');

    api_('POST', "/pawn-tickets/{$id}/promises", ['promise_date' => '2027-01-12'])->assertStatus(422);   // must be future
    api_('POST', "/pawn-tickets/{$id}/promises", ['promise_date' => '2027-01-20', 'remark' => 'Salary on 20th'])->assertCreated();

    $q = api_('POST', '/forfeit/queue', ['ticket_ids' => [$id]])->json('data');
    expect($q['queued'])->toBe([])->and($q['skipped'][0]['reason'])->toContain('2027-01-20');

    api_('POST', "/pawn-tickets/{$id}/promises", ['promise_date' => '2027-01-18'])->assertStatus(422);   // not later
    api_('POST', "/pawn-tickets/{$id}/promises", ['promise_date' => '2027-01-25'])->assertCreated();
    expect(ForfeitPromise::pluck('status')->all())->toBe(['extended', 'pending']);

    at('2027-01-25');
    api_('POST', "/pawn-tickets/{$id}/promises", ['promise_date' => '2027-02-01'])->assertStatus(422);   // date has arrived

    at('2027-01-26');                               // promise broken
    expect(api_('GET', '/forfeit/reminders')->json('data.0.promise.overdue'))->toBeTrue();
    expect(api_('POST', '/forfeit/queue', ['ticket_ids' => [$id]])->json('data.queued'))->toBe([$id]);
    expect(ForfeitPromise::latest('id')->first()->status)->toBe('broken')
        ->and(PawnTicket::find($id)->arrears_stage)->toBe('forfeit_queued');
});

it('forfeits a queued ticket: capital moves to forfeited stock, nothing to income', function () {
    $id = $this->ticket['id'];
    toReminder($id);
    at('2027-01-12');
    api_('POST', '/forfeit/queue', ['ticket_ids' => [$id]])->assertOk();

    api_('POST', '/forfeit/execute', ['ticket_ids' => [$id]], userWithRole('cashier'))->assertForbidden();
    $r = api_('POST', '/forfeit/execute', ['ticket_ids' => [$id]])->assertOk()->json('data');

    expect($r['forfeitures'])->toHaveCount(1);
    $t = PawnTicket::with('items')->find($id);
    expect($t->status)->toBe('forfeited')
        ->and($t->items->pluck('status')->all())->toBe(['forfeited'])
        ->and(ticketBalance($id, 'pawn_loans_receivable'))->toBe('0.00')
        ->and(ticketBalance($id, 'forfeited_stock'))->toBe('40000.00')
        ->and(ticketBalance($id, 'interest_income'))->toBe('0.00');
    assertLedgerBalanced();

    // Forfeiting again does nothing.
    expect(api_('POST', '/forfeit/execute', ['ticket_ids' => [$id]])->json('data.skipped.0.reason'))->toBe('Ticket is forfeited.');
});

it('moves forfeited articles into sale stock with cost and sale price', function () {
    $id = $this->ticket['id'];
    toReminder($id);
    at('2027-01-12');
    api_('POST', '/forfeit/queue', ['ticket_ids' => [$id]]);
    $fid = api_('POST', '/forfeit/execute', ['ticket_ids' => [$id]])->json('data.forfeitures.0');

    expect(collect(api_('GET', '/forfeit/awaiting-transfer')->json('data'))->pluck('id')->all())->toBe([$fid]);

    $batchId = api_('POST', '/forfeit/transfer', ['forfeiture_ids' => [$fid]])->assertCreated()->json('data.id');
    $item = InventoryItem::first();

    expect($item->item_code)->toBe('001-IT000001')
        ->and((string) $item->cost_price)->toBe('40000.00')
        ->and((string) $item->sale_price)->toBe('370000.00')      // B4 sale rate 370,000 per 8 g × 8 g
        ->and($item->status)->toBe('in_stock')
        ->and(PawnTicket::find($id)->items()->value('status'))->toBe('in_stock')
        ->and(api_('GET', '/forfeit/awaiting-transfer')->json('data'))->toBe([]);

    api_('GET', "/stock-transfer-batches/{$batchId}")->assertOk()->assertJsonPath('data.items.0.item_code', '001-IT000001');
    api_('POST', '/forfeit/transfer', ['forfeiture_ids' => [$fid]])->assertStatus(422);
});

it('cannot queue a ticket before its reminder period ends', function () {
    $id = $this->ticket['id'];
    at('2026-12-01');
    issue(1, [$id]);

    expect(api_('POST', '/forfeit/queue', ['ticket_ids' => [$id]])->json('data.skipped.0.reason'))
        ->toBe('Forfeit reminder period has not ended.');
});
