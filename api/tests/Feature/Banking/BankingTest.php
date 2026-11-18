<?php

use App\Domain\Accounting\Models\Account;
use App\Domain\Banking\Models\Bank;
use App\Domain\Banking\Models\BankAccount;

beforeEach(function () {
    $this->accountant = userWithRole('accountant');
    $bank = Bank::create(['code' => '7083', 'name' => 'Hatton National Bank']);
    $this->bankBranch = $bank->branches()->create(['code' => '045', 'name' => 'Balangoda']);
    $this->bank = api_('POST', '/banking/accounts', [
        'bank_branch_id' => $this->bankBranch->id, 'account_no' => '045010012345', 'account_name' => 'Sampath Current',
    ], $this->accountant)->assertCreated()->json('data');
    // Opening float in cash.
    api_('POST', '/accounting/journals', ['entry_date' => today()->toDateString(), 'narration' => 'Float', 'lines' => [
        ['account_id' => acc('cash'), 'debit' => 500000], ['account_id' => acc('capital'), 'credit' => 500000],
    ]], $this->accountant)->assertCreated();
});

function bankLedger(): int
{
    return test()->bank['account_id'];
}

function bal(int $accountId): string
{
    return app(\App\Domain\Accounting\Services\AccountBalances::class)->balance($accountId);
}

it('creates a bank account with its own ledger account', function () {
    $ledger = Account::find(bankLedger());

    expect($ledger->code)->toBe('1200')->and($ledger->is_bank)->toBeTrue()->and($ledger->name)->toBe('Bank - Sampath Current');
    api_('GET', '/banking/accounts', [], $this->accountant)->assertOk()->assertJsonPath('data.0.balance', '0.00');
});

it('transfers cash to the bank', function () {
    api_('POST', '/banking/transfers', ['from_account_id' => acc('cash'), 'to_account_id' => bankLedger(), 'amount' => 200000, 'date' => today()->toDateString()], $this->accountant)
        ->assertCreated();

    expect(bal(bankLedger()))->toBe('200000.00')->and(bal(acc('cash')))->toBe('300000.00');

    api_('POST', '/banking/transfers', ['from_account_id' => acc('cash'), 'to_account_id' => acc('5120'), 'amount' => 1, 'date' => today()->toDateString()], $this->accountant)
        ->assertStatus(422);
});

it('runs a received cheque through deposit and clearing, and handles a bounce', function () {
    $c = api_('POST', '/banking/cheques/receive', [
        'cheque_no' => '100234', 'bank_branch_id' => $this->bankBranch->id, 'party_name' => 'Buyer', 'amount' => 45000,
        'cheque_date' => today()->toDateString(), 'counter_account_id' => acc('sales_income'),
    ], $this->accountant)->assertCreated()->json('data');
    expect(bal(acc('cheques_in_hand')))->toBe('45000.00');

    api_('POST', "/banking/cheques/{$c['id']}/clear", [], $this->accountant)->assertStatus(422);       // not deposited yet
    api_('POST', "/banking/cheques/{$c['id']}/deposit", ['bank_account_id' => $this->bank['id']], $this->accountant)->assertOk();
    expect(bal(acc('cheques_in_hand')))->toBe('0.00')->and(bal(bankLedger()))->toBe('45000.00');

    api_('POST', "/banking/cheques/{$c['id']}/return", ['reason' => 'Insufficient funds'], $this->accountant)->assertOk()->assertJsonPath('data.status', 'returned');
    expect(bal(bankLedger()))->toBe('0.00')->and(bal(acc('sales_income')))->toBe('0.00');
    assertLedgerBalanced();
});

it('issues and cancels a cheque', function () {
    $c = api_('POST', '/banking/cheques/issue', [
        'cheque_no' => '500001', 'bank_account_id' => $this->bank['id'], 'party_name' => 'Landlord', 'amount' => 30000,
        'cheque_date' => today()->toDateString(), 'counter_account_id' => acc('5123'),
    ], $this->accountant)->assertCreated()->json('data');
    expect(bal(acc('5123')))->toBe('30000.00')->and(bal(bankLedger()))->toBe('-30000.00');

    api_('POST', "/banking/cheques/{$c['id']}/return", ['reason' => 'Wrong amount'], $this->accountant)->assertOk()->assertJsonPath('data.status', 'cancelled');
    expect(bal(bankLedger()))->toBe('0.00');
});

it('reconciles a bank statement only when it balances', function () {
    api_('POST', '/banking/transfers', ['from_account_id' => acc('cash'), 'to_account_id' => bankLedger(), 'amount' => 100000, 'date' => today()->toDateString()], $this->accountant);
    api_('POST', '/banking/transfers', ['from_account_id' => acc('cash'), 'to_account_id' => bankLedger(), 'amount' => 50000, 'date' => today()->toDateString()], $this->accountant);
    $date = today()->toDateString();

    $r = api_('GET', "/banking/accounts/{$this->bank['id']}/reconciliation?statement_date={$date}", [], $this->accountant)->assertOk()->json('data');
    expect($r['book_balance'])->toBe('150000.00')->and($r['lines'])->toHaveCount(2);
    $first = $r['lines'][0]['id'];

    // Statement shows only the first deposit.
    api_('POST', "/banking/accounts/{$this->bank['id']}/reconciliation", [
        'statement_date' => $date, 'statement_balance' => 100000, 'line_ids' => [$first], 'complete' => true,
    ], $this->accountant)->assertOk()->assertJsonPath('data.status', 'completed');

    api_('POST', "/banking/accounts/{$this->bank['id']}/reconciliation", [
        'statement_date' => $date, 'statement_balance' => 100000, 'line_ids' => [], 'complete' => true,
    ], $this->accountant)->assertStatus(422);   // already completed

    $next = today()->addDay()->toDateString();
    $r2 = api_('GET', "/banking/accounts/{$this->bank['id']}/reconciliation?statement_date={$next}", [], $this->accountant)->json('data');
    expect($r2['lines'])->toHaveCount(1)->and($r2['cleared_before'])->toBe('100000.00');

    api_('POST', "/banking/accounts/{$this->bank['id']}/reconciliation", [
        'statement_date' => $next, 'statement_balance' => 140000, 'line_ids' => [$r2['lines'][0]['id']], 'complete' => true,
    ], $this->accountant)->assertStatus(422)->assertJsonValidationErrors('statement_balance');
});

it('keeps banking for authorised roles only', function () {
    api_('GET', '/banking/cheques', [], userWithRole('cashier'))->assertForbidden();
    expect(BankAccount::count())->toBe(1);
});
