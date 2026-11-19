<?php

use App\Domain\Customers\Models\Customer;
use App\Domain\Reports\Services\ReportService;
use Carbon\Carbon;

beforeEach(function () {
    Carbon::setTestNow('2026-11-10 10:00:00');
    $this->cashier = userWithRole('branch_manager');
    $this->customer = Customer::create([
        'branch_id' => branch()->id, 'code' => 'C001RPT', 'first_name' => '=HYPERLINK("x")', 'last_name' => 'Test',
        'nic' => '881234567V', 'address_line1' => 'No 2', 'phone1' => '0772223334',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

it('builds the dashboard for the working branch', function () {
    $a = pawn(40000, 3);
    pawn(20000, 1);
    api_('POST', "/pawn-tickets/{$a['id']}/redemption", [])->assertCreated();

    $d = api_('GET', '/dashboard')->assertOk()->json('data');

    expect($d['active']['tickets'])->toBe(1)
        ->and($d['active']['capital'])->toBe('20000.00')
        ->and($d['today']['pawns'])->toBe(2)
        ->and($d['today']['lent'])->toBe('60000.00')
        ->and($d['today']['redemptions'])->toBe(1)
        ->and($d['trend'])->toHaveCount(30)
        ->and(end($d['trend'])['lent'])->toBe('60000.00')
        ->and($d['schemes'][0]['scheme'])->toBe('A')
        ->and($d['income_this_month'])->toBe('460.00');      // 1% interest + Rs. 60 service

    expect(api_('GET', '/dashboard', [], userWithRole('cashier', '002'))->json('data.active.tickets'))->toBe(0);
});

it('runs every report without errors', function (string $key) {
    $t = pawn(40000, 1);
    api_('POST', "/pawn-tickets/{$t['id']}/part-payment", ['amount' => 5000, 'months' => 1]);

    api_('GET', "/reports/{$key}?from=2026-11-01&to=2026-11-30")->assertOk()
        ->assertJsonStructure(['data' => ['title', 'columns', 'rows', 'totals' => ['count']]]);
})->with(array_keys(ReportService::REPORTS));

it('lists new pawns with totals', function () {
    pawn(40000, 3);
    pawn(25000, 2);

    $r = api_('GET', '/reports/pawns?from=2026-11-01&to=2026-11-30')->json('data');
    expect($r['rows'])->toHaveCount(2)
        ->and($r['totals']['principal_original'])->toBe('65000.00')
        ->and($r['totals']['count'])->toBe(2);
});

it('exports CSV safely for Excel', function () {
    pawn(40000, 3);

    $res = api_('GET', '/reports/pawns?from=2026-11-01&to=2026-11-30&format=csv')->assertOk();
    $csv = $res->streamedContent();

    expect($res->headers->get('content-type'))->toContain('text/csv')
        ->and($csv)->toStartWith("\xEF\xBB\xBF")
        ->and($csv)->toContain('Receipt,Stock,Customer')
        ->and($csv)->toContain("'=HYPERLINK");        // formula neutralised
});

it('restricts reports by permission and all-branch view', function () {
    api_('GET', '/reports/pawns', [], userWithRole('valuer'))->assertForbidden();
    api_('GET', '/reports/pawns?branch=all', [], userWithRole('cashier'))->assertForbidden();
    api_('GET', '/reports/pawns?branch=all', [], userWithRole('accountant'))->assertOk();
    api_('GET', '/reports/nonsense')->assertNotFound();
});

it('runs a vault stock check and reports missing packets', function () {
    $a = pawn(40000, 3);
    $b = pawn(20000, 3);
    pawn(10000, 3);

    $session = api_('POST', '/stock-checks', ['notes' => 'Monthly check'])->assertCreated()->json('data.id');
    api_('POST', '/stock-checks', [])->assertStatus(422);                           // one open session per branch

    api_('POST', "/stock-checks/{$session}/scan", ['code' => $a['stock_no']])->assertOk()->assertJsonPath('data.already_checked', false);
    api_('POST', "/stock-checks/{$session}/scan", ['code' => $a['stock_no']])->assertOk()->assertJsonPath('data.already_checked', true);
    api_('POST', "/stock-checks/{$session}/scan", ['code' => $b['receipt_no']])->assertOk();
    api_('POST', "/stock-checks/{$session}/scan", ['code' => 'NOPE'])->assertStatus(422);

    $s = api_('POST', "/stock-checks/{$session}/complete")->assertOk()->json('data');
    expect($s['checked_count'])->toBe(2)->and($s['missing_count'])->toBe(1)->and($s['session']['status'])->toBe('completed');

    api_('POST', "/stock-checks/{$session}/scan", ['code' => $a['stock_no']])->assertStatus(422);
    api_('GET', '/stock-checks', [], userWithRole('cashier'))->assertForbidden();
});
