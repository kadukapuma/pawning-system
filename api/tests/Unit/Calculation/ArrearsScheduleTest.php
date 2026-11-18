<?php

use App\Domain\Pawning\Calculation\ArrearsSchedule;

/*
 * Expected values from sampath-old/tests/Unit/ReceiptArrearsRulesTest.php
 * and ReceiptPenaltyScheduleTest.php.
 */

const DEFAULT_INTERVALS = [2 => 21, 3 => 21];

it('anchors letter 1 to expiry and later letters to the previous print', function () {
    $printed = [1 => '2026-01-10', 2 => '2026-01-31'];

    expect(ArrearsSchedule::dueDate(1, '2026-01-10', $printed, DEFAULT_INTERVALS)->toDateString())->toBe('2026-01-10')
        ->and(ArrearsSchedule::dueDate(2, '2026-01-10', $printed, DEFAULT_INTERVALS)->toDateString())->toBe('2026-01-31')
        ->and(ArrearsSchedule::dueDate(3, '2026-01-10', $printed, DEFAULT_INTERVALS)->toDateString())->toBe('2026-02-21');
});

it('starts the next interval from a late first letter', function () {
    $printed = [1 => '2026-02-10'];

    expect(ArrearsSchedule::dueDate(2, '2026-01-01', $printed, DEFAULT_INTERVALS)->toDateString())->toBe('2026-03-03')
        ->and(ArrearsSchedule::isEligible(2, '2026-01-01', $printed, DEFAULT_INTERVALS, '2026-02-10'))->toBeFalse()
        ->and(ArrearsSchedule::isEligible(2, '2026-01-01', $printed, DEFAULT_INTERVALS, '2026-03-03'))->toBeTrue();
});

it('makes letter 1 printable on the expiry date', function () {
    expect(ArrearsSchedule::isEligible(1, '2026-10-01', [], DEFAULT_INTERVALS, '2026-09-30'))->toBeFalse()
        ->and(ArrearsSchedule::isEligible(1, '2026-10-01', [], DEFAULT_INTERVALS, '2026-10-01'))->toBeTrue();
});

it('does not let a letter from an old cycle advance the new one', function () {
    expect(ArrearsSchedule::isEligible(2, '2026-10-01', [1 => '2026-08-01'], [2 => 14, 3 => 21], '2026-10-14'))->toBeFalse();
});

it('prints letters in order and only once', function () {
    expect(ArrearsSchedule::isEligible(3, '2026-01-01', [1 => '2026-01-01'], DEFAULT_INTERVALS, '2026-06-01'))->toBeFalse()
        ->and(ArrearsSchedule::isEligible(1, '2026-01-01', [1 => '2026-01-01'], DEFAULT_INTERVALS, '2026-06-01'))->toBeFalse()
        ->and(ArrearsSchedule::isEligible(2, '2026-01-01', [1 => '2026-01-01', 2 => '2026-01-22'], DEFAULT_INTERVALS, '2026-06-01'))->toBeFalse();
});

it('puts a ticket on the forfeit reminder list after letter 3 + reminder days', function () {
    $due = fn (string $today, ?string $paid = null, string $cycle = '2025-10-01') => ArrearsSchedule::reminderIsDue(
        letter3PrintedAt: '2026-02-21', reminderDays: 21, expiry: '2026-01-01',
        cycleStart: $cycle, lastPaymentOrRenewalDate: $paid, today: $today,
    );

    expect(ArrearsSchedule::reminderDueDate('2026-02-21', 21)->toDateString())->toBe('2026-03-14')
        ->and($due('2026-03-13'))->toBeFalse()
        ->and($due('2026-03-14'))->toBeTrue()
        ->and($due('2026-03-14', paid: '2026-03-01'))->toBeFalse()          // paid after letter 3
        ->and($due('2026-03-14', cycle: '2026-03-01'))->toBeFalse()         // letter from an older cycle
        ->and(ArrearsSchedule::reminderIsDue(null, 21, '2026-01-01', '2025-10-01', null, '2026-12-01'))->toBeFalse();
});
