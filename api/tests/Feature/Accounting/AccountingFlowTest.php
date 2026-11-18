<?php

use App\Domain\Accounting\Models\Account;
use App\Domain\Accounting\Models\JournalEntry;
use App\Domain\Customers\Models\Customer;
use Carbon\Carbon;

beforeEach(function () {
    Carbon::setTestNow('2026-11-10 09:00:00');
    $this->cashier = userWithRole('branch_manager');
    $this->accountant = userWithRole('accountant');
    $this->customer = Customer::create([
        'branch_id' => branch()->id, 'code' => 'C001ACC', 'first_name' => 'Sunil', 'nic' => '771234567V',
        'address_line1' => 'No 1', 'phone1' => '0771112223',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

function acc(string $codeOrKey): int
{
    return Account::where('system_key', $codeOrKey)->orWhere('code', $codeOrKey)->value('id');
}

function expenseVoucher(float $amount = 2500, $user = null)
{
    return api_('POST', '/accounting/vouchers', [
        'type' => 'expense', 'voucher_date' => today()->toDateString(), 'account_id' => acc('5120'),
        'cash_account_id' => acc('cash'), 'amount' => $amount, 'party_name' => 'CEB', 'description' => 'Electricity bill',
    ], $user ?? test()->cashier);
}

it('posts a voucher only when a different person approves it', function () {
    $v = expenseVoucher()->assertCreated()->json('data');
    expect($v['status'])->toBe('pending')->and($v['voucher_no'])->toBe('EX000001')
        ->and(JournalEntry::count())->toBe(0);

    api_('POST', "/accounting/vouchers/{$v['id']}/approve", [], $this->cashier)
        ->assertStatus(422)->assertJsonPath('errors.voucher.0', 'You cannot approve a voucher you requested.');
    api_('POST', "/accounting/vouchers/{$v['id']}/approve", [], $this->accountant)->assertOk()->assertJsonPath('data.status', 'posted');

    $j = JournalEntry::with('lines.account')->latest('id')->first();
    expect($j->lines->firstWhere('debit', '2500.00')->account->code)->toBe('5120')
        ->and($j->lines->firstWhere('credit', '2500.00')->account->system_key)->toBe('cash');

    api_('POST', "/accounting/vouchers/{$v['id']}/approve", [], $this->accountant)->assertStatus(422);
});

it('rejects a voucher with a reason and refuses cash-to-cash vouchers', function () {
    $v = expenseVoucher()->json('data');
    api_('POST', "/accounting/vouchers/{$v['id']}/reject", ['reason' => 'No bill attached'], $this->accountant)
        ->assertOk()->assertJsonPath('data.status', 'rejected');

    api_('POST', '/accounting/vouchers', [
        'type' => 'payment', 'voucher_date' => today()->toDateString(), 'account_id' => acc('cash'),
        'cash_account_id' => acc('cash'), 'amount' => 100,
    ], $this->cashier)->assertStatus(422)->assertJsonValidationErrors('account_id');
});

it('posts balanced manual journals and only reverses manual ones', function () {
    api_('POST', '/accounting/journals', ['entry_date' => today()->toDateString(), 'narration' => 'Bad', 'lines' => [
        ['account_id' => acc('capital'), 'credit' => 100000], ['account_id' => acc('cash'), 'debit' => 90000],
    ]], $this->accountant)->assertStatus(422);

    $j = api_('POST', '/accounting/journals', ['entry_date' => today()->toDateString(), 'narration' => 'Owner capital', 'lines' => [
        ['account_id' => acc('cash'), 'debit' => 100000], ['account_id' => acc('capital'), 'credit' => 100000],
    ]], $this->accountant)->assertCreated()->json('data');

    api_('POST', "/accounting/journals/{$j['id']}/reverse", ['reason' => 'Entered twice'], $this->accountant)->assertOk();

    pawn(40000, 3);
    $pawnJournal = JournalEntry::whereNotNull('source_type')->first();
    api_('POST', "/accounting/journals/{$pawnJournal->id}/reverse", ['reason' => 'x'], $this->accountant)->assertStatus(422);
});

it('shows the cash book and closes the day, after which nothing more can be posted', function () {
    api_('POST', '/accounting/journals', ['entry_date' => today()->toDateString(), 'narration' => 'Float', 'lines' => [
        ['account_id' => acc('cash'), 'debit' => 100000], ['account_id' => acc('head_office_current'), 'credit' => 100000],
    ]], $this->accountant)->assertCreated();
    pawn(40000, 3);

    $book = api_('GET', '/accounting/cash-book', [], $this->cashier)->assertOk()->json('data');
    expect($book['opening'])->toBe('0.00')
        ->and($book['total_in'])->toBe('100000.00')
        ->and($book['total_out'])->toBe('40000.00')
        ->and($book['closing'])->toBe('60000.00')
        ->and($book['lines'])->toHaveCount(2)
        ->and($book['lines'][1]['balance'])->toBe('60000.00');

    api_('POST', '/accounting/day-closings', ['date' => today()->toDateString(), 'physical_cash' => 59990], $this->cashier)
        ->assertOk()->assertJsonPath('data.variance', '-10.00')->assertJsonPath('data.status', 'closed');

    api_('POST', '/pawn-tickets', ['customer_id' => $this->customer->id, 'items' => [item()], 'amount' => 1000, 'months' => 1])
        ->assertStatus(422)->assertJsonValidationErrors('date');

    api_('POST', '/accounting/day-closings/reopen', ['date' => today()->toDateString(), 'reason' => 'Late pawn'], $this->accountant)->assertOk();
    pawn(1000, 1);

    Carbon::setTestNow('2026-11-11 09:00:00');
    expect(api_('GET', '/accounting/cash-book', [], $this->cashier)->json('data.opening'))->toBe('59000.00');
});

it('produces a balanced trial balance, P&L and balance sheet', function () {
    api_('POST', '/accounting/journals', ['entry_date' => today()->toDateString(), 'narration' => 'Capital', 'lines' => [
        ['account_id' => acc('cash'), 'debit' => 200000], ['account_id' => acc('capital'), 'credit' => 200000],
    ]], $this->accountant);
    $t = pawn(40000, 3);
    Carbon::setTestNow('2026-11-15 09:00:00');                         // day 6 → 1% = 400, service 60
    api_('POST', "/pawn-tickets/{$t['id']}/redemption", [])->assertCreated();
    $v = expenseVoucher(2500)->json('data');
    api_('POST', "/accounting/vouchers/{$v['id']}/approve", [], $this->accountant);

    $tb = api_('GET', '/accounting/trial-balance', [], $this->accountant)->assertOk()->json('data');
    expect($tb['balanced'])->toBeTrue()->and($tb['total_debit'])->toBe($tb['total_credit']);

    $pl = api_('GET', '/accounting/profit-and-loss?from=2026-11-01&to=2026-11-30', [], $this->accountant)->json('data');
    expect($pl['total_income'])->toBe('460.00')                          // interest 400 + service 60
        ->and($pl['total_expenses'])->toBe('2500.00')
        ->and($pl['net_profit'])->toBe('-2040.00');

    $bs = api_('GET', '/accounting/balance-sheet', [], $this->accountant)->json('data');
    expect($bs['balanced'])->toBeTrue()
        ->and($bs['total_assets'])->toBe('197960.00')                    // 200,000 − 40,000 + 40,460 − 2,500
        ->and($bs['current_profit'])->toBe('-2040.00');
});

it('needs permission for all-branch reports', function () {
    api_('GET', '/accounting/trial-balance?branch=all', [], $this->cashier)->assertForbidden();
    api_('GET', '/accounting/trial-balance?branch=all', [], $this->accountant)->assertOk();
});
