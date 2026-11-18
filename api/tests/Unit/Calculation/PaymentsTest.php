<?php

use App\Domain\Pawning\Calculation\CycleDates;
use App\Domain\Pawning\Calculation\InterestTerms;
use App\Domain\Pawning\Calculation\PartPaymentAllocation;
use App\Domain\Pawning\Calculation\RedemptionCalculator;
use App\Domain\Pawning\Calculation\RenewalCalculator;
use App\Domain\Pawning\Calculation\TicketStatement;
use App\Domain\Pawning\Calculation\Valuation;
use Illuminate\Validation\ValidationException;

/* ---------------------------------------------------------- Part payment
 * Expected values from sampath-old/tests/Unit/PartPaymentCalculatorTest.php
 */

it('pays interest first, then capital', function () {
    $r = PartPaymentAllocation::calculate(33795, 837, 0, 0, 0, 6000);

    expect($r->paidInterest)->toBe('837.00')
        ->and($r->principalPaid)->toBe('5163.00')
        ->and($r->newPrincipal)->toBe('28632.00')
        ->and($r->capitalisedInterest)->toBe('0.00');
});

it('capitalises only the unpaid interest when the payment is below interest', function () {
    $r = PartPaymentAllocation::calculate(5000, 200, 0, 0, 0, 150);

    expect($r->paidInterest)->toBe('150.00')
        ->and($r->principalPaid)->toBe('0.00')
        ->and($r->capitalisedInterest)->toBe('50.00')
        ->and($r->newPrincipal)->toBe('5050.00')
        ->and($r->redemptionTotal)->toBe('5200.00');
});

it('adds unpaid postage and interest to capital exactly once', function () {
    $r = PartPaymentAllocation::calculate(14000, 350, 60, 125, 0, 300);

    expect($r->principalPaid)->toBe('0.00')
        ->and($r->capitalisedInterest)->toBe('50.00')
        ->and($r->capitalisedCharges)->toBe('185.00')
        ->and($r->newPrincipal)->toBe('14235.00');
});

it('handles the Rathnapura receipt 5542 case', function () {
    $r = PartPaymentAllocation::calculate(35308, '7502.95', 0, 250, 0, 150);

    expect($r->paymentReceived)->toBe('150.00')
        ->and($r->capitalisedInterest)->toBe('7352.95')
        ->and($r->capitalisedCharges)->toBe('250.00')
        ->and($r->newPrincipal)->toBe('42910.95');
});

it('capitalises only the postage remainder when interest is covered', function () {
    $r = PartPaymentAllocation::calculate(5000, 200, 0, 125, 0, 250);

    expect($r->paidInterest)->toBe('200.00')
        ->and($r->capitalisedInterest)->toBe('0.00')
        ->and($r->capitalisedCharges)->toBe('75.00')
        ->and($r->newPrincipal)->toBe('5075.00');
});

it('does not capitalise discounted interest again', function () {
    $r = PartPaymentAllocation::calculate(5000, 200, 0, 0, 0, 150, 50);

    expect($r->paymentReceived)->toBe('100.00')
        ->and($r->paidInterest)->toBe('100.00')
        ->and($r->capitalisedInterest)->toBe('50.00')
        ->and($r->newPrincipal)->toBe('5050.00');
});

it('lets a second same-day payment reduce capital only', function () {
    $first = PartPaymentAllocation::calculate(10000, 250, 0, 0, 0, 250);
    $second = PartPaymentAllocation::calculate($first->newPrincipal, 0, 0, 0, 0, 1000);

    expect($first->paidInterest)->toBe('250.00')
        ->and($second->principalPaid)->toBe('1000.00')
        ->and($second->newPrincipal)->toBe('9000.00');
});

it('sends full payments to redemption and keeps Rs. 1,000 minimum capital', function () {
    expect(fn () => PartPaymentAllocation::calculate(5000, 200, 0, 0, 0, 5200)->assertAllowed())
        ->toThrow(ValidationException::class, 'Use Redemption');
    expect(fn () => PartPaymentAllocation::calculate(5000, 200, 0, 0, 0, 4500)->assertAllowed())
        ->toThrow(ValidationException::class, 'Rs. 1,000.00');

    PartPaymentAllocation::calculate(5000, 200, 0, 0, 0, 4200)->assertAllowed();   // leaves exactly 1,000
    expect(true)->toBeTrue();
});

it('starts the next cycle the day after a part payment', function () {
    expect(CycleDates::cycleStartAfterPartPayment('2026-10-01')->toDateString())->toBe('2026-10-02');
});

/* ---------------------------------------------------------- Valuation & term */

it('values articles at rate ÷ 8 × weight', function () {
    expect(Valuation::articleValue(38800, 8))->toBe('38800.00')
        ->and(Valuation::articleValue(340000, '7.500'))->toBe('318750.00')
        ->and(Valuation::articleValue(2950, '10.25'))->toBe('3779.69');
});

it('builds the term table and picks the longest fully covered term', function () {
    $caps = Valuation::termCapacities(38800, '2.5', 12);

    expect($caps[1])->toBe('38800.00')
        ->and($caps[2])->toBe('37830.00')
        ->and($caps[9])->toBe('31040.00')
        ->and(Valuation::maxTermForLoan(31040, 38800, '2.5'))->toBe(9)
        ->and(Valuation::maxTermForLoan(31041, 38800, '2.5'))->toBe(8)
        ->and(Valuation::maxTermForLoan(38801, 38800, '2.5'))->toBe(0);
});

it('sets maturity by months for gold and by valid days for silver', function () {
    expect(CycleDates::maturity('2026-01-31', 1, false, 0)->toDateString())->toBe('2026-02-28')   // no overflow
        ->and(CycleDates::maturity('2026-03-15', 3, false, 0)->toDateString())->toBe('2026-06-15')
        ->and(CycleDates::maturity('2026-03-15', 3, true, 30)->toDateString())->toBe('2026-04-14');
});

/* ---------------------------------------------------------- Renewal
 * Expected values from sampath-old/tests/Unit/RepawningCalculatorTest.php
 */

it('builds the renewal month table', function () {
    $p = RenewalCalculator::preview(
        articleValue: 38800, principal: 30000, interest: '486.05', serviceCharge: 125,
        letterCharge: 0, stampDuty: 0, monthlyRate: '2.5', validMonths: 9,
    );

    expect($p['article_value'])->toBe('38800.00')
        ->and($p['monthly_interest'])->toBe('970.00')
        ->and($p['month_options'][1])->toBe('8188.95')
        ->and($p['month_options'][2])->toBe('7218.95')
        ->and($p['month_options'][9])->toBe('428.95')
        ->and($p['month_options'][10])->toBeNull();
});

it('capitalises everything owed into the renewed principal', function () {
    expect(RenewalCalculator::newPrincipal(30000, 5000, '486.05', 125, 150, 0, '11.05'))->toBe('35750.00');
});

/* ---------------------------------------------------------- Redemption */

it('totals a redemption with discount', function () {
    $s = TicketStatement::calculate(10000, '2026-01-01', '2026-01-10', new InterestTerms('tiered', 10, '1', 15, '2', 30, '2.5', 90), serviceCharge: 60, letterCharges: [1 => 125]);
    $t = RedemptionCalculator::totals($s, 0, 25);

    expect($t['payable'])->toBe('10260.00');   // 10000 + 100 + 60 + 125 − 25
    expect(fn () => RedemptionCalculator::totals($s, 0, 300))->toThrow(ValidationException::class);
});

it('allows cash rounding under Rs. 5 only', function () {
    expect(RedemptionCalculator::roundingAdjustment('10258.33', '10260.00'))->toBe('1.67')
        ->and(RedemptionCalculator::roundingAdjustment('10258.33', '10255.00'))->toBe('-3.33')
        ->and(RedemptionCalculator::roundingAdjustment('10258.33', '10258.33'))->toBeNull();

    expect(fn () => RedemptionCalculator::roundingAdjustment('10258.33', '10263.33'))->toThrow(ValidationException::class);
});
