<?php

use App\Domain\Pawning\Calculation\InterestCalculator;
use App\Domain\Pawning\Calculation\InterestTerms;
use App\Domain\Pawning\Calculation\TicketStatement;

/*
 * Expected values come from the old system's tests
 * (sampath-old/tests/Unit/*Interest*, ReceiptArrearsRulesTest, RedeemSameDayPartPaymentTest).
 */

function goldA(): InterestTerms
{
    // Scheme A as seeded: 10 d → 1%, 15 d → 2%, then 2.5% per month.
    return new InterestTerms('tiered', 10, '1', 15, '2', 30, '2.5', 90);
}

function silver(): InterestTerms
{
    return new InterestTerms('silver', 10, '6', 15, '6', 30, '6', 30);
}

it('counts interest days inclusively from the cycle start', function () {
    expect(InterestCalculator::days('2026-09-01', '2026-09-13'))->toBe(13)
        ->and(InterestCalculator::days('2026-09-14', '2026-09-13'))->toBe(0)   // day before a new cycle
        ->and(InterestCalculator::days('2026-09-05', '2026-09-13'))->toBe(9)
        ->and(InterestCalculator::days('2026-09-05', '2026-09-05'))->toBe(1);
});

it('charges gold tiered interest by period, then per month and day', function (int $days, string $expected) {
    expect(InterestCalculator::gross(10000, $days, goldA()))->toBe($expected);
})->with([
    'day 1 (rate 1)' => [1, '100.00'],
    'day 10 (rate 1)' => [10, '100.00'],
    'day 11 (rate 2)' => [11, '200.00'],
    'day 15 (rate 2)' => [15, '200.00'],
    'day 16 (rate 3)' => [16, '250.00'],
    'day 30 (rate 3)' => [30, '250.00'],
    'day 31 (+1 day)' => [31, '258.33'],    // 2.5 + 2.5/30 = 2.58333…%
    'day 45' => [45, '375.00'],
    'day 60' => [60, '500.00'],
    'day 0' => [0, '0.00'],
]);

it('uses period 1 interest the day after a part payment (old same-day test)', function () {
    $t = new InterestTerms('tiered', 7, '1.5', 14, '2', 30, '2.5', 90);

    expect(InterestCalculator::gross(50000, 1, $t))->toBe('750.00')
        ->and(InterestCalculator::gross(50000, 7, $t))->toBe('750.00')
        ->and(InterestCalculator::gross(50000, 8, $t))->toBe('1000.00');
});

it('charges silver one full period minimum then daily', function (int $days, string $expected) {
    expect(InterestCalculator::gross(10000, $days, silver()))->toBe($expected);
})->with([
    [1, '600.00'], [30, '600.00'], [31, '620.00'], [45, '900.00'], [0, '0.00'],
]);

it('charges the old type D monthly rate plus a penalty after the valid period', function () {
    // rate2 2% per started month; 0.5% penalty per started month after 90 days.
    $d = new InterestTerms('monthly_penalty', 10, '1', 15, '2', 30, '2.5', 90, '0.5');

    expect(InterestCalculator::gross(10000, 30, $d))->toBe('200.00')
        ->and(InterestCalculator::gross(10000, 31, $d))->toBe('400.00')
        ->and(InterestCalculator::gross(10000, 90, $d))->toBe('600.00')
        ->and(InterestCalculator::gross(10000, 91, $d))->toBe('850.00');   // 4 months × 2% + 1 × 0.5%
});

it('builds the arrears and redemption totals (old ReceiptArrearsRulesTest)', function () {
    $s = TicketStatement::calculate(
        principal: 10000, cycleStart: '2026-01-01', asOf: '2026-01-10', terms: goldA(),
        serviceCharge: 60, letterCharges: [1 => 125, 2 => 125],
    );

    expect($s->interest)->toBe('100.00')
        ->and($s->serviceCharge)->toBe('60.00')
        ->and($s->letterCharge)->toBe('250.00')
        ->and($s->letterCharges)->toBe([1 => '125.00', 2 => '125.00', 3 => '0.00'])
        ->and($s->arrearsTotal)->toBe('410.00')
        ->and($s->redemptionTotal)->toBe('10410.00');
});

it('subtracts interest already paid and adds carried interest', function () {
    // Silver: day 31 gross 620, 100 already paid → 520 (old SilverInterestTest).
    $s = TicketStatement::calculate(10000, '2026-01-01', '2026-01-31', silver(), interestPaidThisCycle: 100);
    expect($s->days)->toBe(31)->and($s->grossInterest)->toBe('620.00')->and($s->interest)->toBe('520.00');

    // Same day as a part payment: only carried interest is owed (old RedeemSameDayPartPaymentTest).
    $t = new InterestTerms('tiered', 7, '1.5', 14, '2', 30, '2.5', 90);
    $same = TicketStatement::calculate(40000, '2026-10-02', '2026-10-01', $t, carriedInterest: '125.50');
    expect($same->days)->toBe(0)->and($same->interest)->toBe('125.50')->and($same->redemptionTotal)->toBe('40125.50');

    $next = TicketStatement::calculate(40000, '2026-10-02', '2026-10-02', $t, carriedInterest: '125.50');
    expect($next->interest)->toBe('725.50');
});

it('never returns negative interest when more was paid than accrued', function () {
    $s = TicketStatement::calculate(10000, '2026-01-01', '2026-01-05', goldA(), interestPaidThisCycle: 500);

    expect($s->interest)->toBe('0.00');
});
