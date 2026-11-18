<?php

use App\Domain\Accounting\Models\JournalEntry;
use App\Domain\Accounting\Models\JournalLine;
use App\Domain\Accounting\Services\JournalLineData;
use App\Domain\Accounting\Services\LedgerPoster;
use App\Domain\Accounting\Services\UnbalancedJournalException;
use Illuminate\Support\Facades\DB;

beforeEach(fn () => useBranch('001'));

function poster(): LedgerPoster
{
    return app(LedgerPoster::class);
}

it('posts a balanced redemption entry with a journal number', function () {
    $entry = poster()->post([
        JournalLineData::debit('cash', '26180.00'),
        JournalLineData::debit('discount_allowed', '20.00'),
        JournalLineData::credit('pawn_loans_receivable', '25000.00'),
        JournalLineData::credit('interest_income', '1050.00'),
        JournalLineData::credit('service_charge_income', '60.00'),
        JournalLineData::credit('postage_income', '90.00'),
    ], 'Redemption RD000001', '2026-11-18');

    expect($entry->entry_no)->toBe('JE0000001')
        ->and($entry->status)->toBe('posted')
        ->and($entry->lines)->toHaveCount(6)
        ->and((string) $entry->lines->sum('debit'))->toBe((string) $entry->lines->sum('credit'));
});

it('rejects an unbalanced entry and writes nothing', function () {
    expect(fn () => poster()->post([
        JournalLineData::debit('cash', '100.00'),
        JournalLineData::credit('interest_income', '99.99'),
    ], 'Bad'))->toThrow(UnbalancedJournalException::class);

    expect(JournalEntry::count())->toBe(0)->and(JournalLine::count())->toBe(0);
});

it('drops zero-amount lines so optional charges can be passed as 0', function () {
    $entry = poster()->post([
        JournalLineData::debit('cash', '500'),
        JournalLineData::credit('interest_income', '500'),
        JournalLineData::credit('postage_income', '0'),
    ], 'Interest only');

    expect($entry->lines)->toHaveCount(2);
});

it('needs at least two non-zero lines', function () {
    poster()->post([JournalLineData::debit('cash', '0'), JournalLineData::credit('cash', '0')], 'Empty');
})->throws(InvalidArgumentException::class, 'at least two');

it('rejects an unknown system account', function () {
    poster()->post([JournalLineData::debit('no_such_account', 10), JournalLineData::credit('cash', 10)], 'x');
})->throws(RuntimeException::class, 'System account [no_such_account]');

it('rounds money exactly without float errors', function () {
    $entry = poster()->post([
        JournalLineData::debit('cash', '0.10'),
        JournalLineData::debit('cash', '0.20'),
        JournalLineData::credit('interest_income', '0.30'),
    ], 'Float trap');

    expect($entry->lines->pluck('credit')->filter(fn ($c) => $c !== '0.00')->first())->toBe('0.30');
});

it('reverses an entry with mirror lines and marks the original', function () {
    $entry = poster()->post([
        JournalLineData::debit('pawn_loans_receivable', '25000'),
        JournalLineData::credit('cash', '25000'),
    ], 'Pawn 000001');

    $reversal = poster()->reverse($entry, 'Cancelled same day');

    expect($entry->fresh()->status)->toBe('reversed')
        ->and($reversal->reversal_of_id)->toBe($entry->id)
        ->and($reversal->narration)->toStartWith('Reversal of JE0000001');

    // Net effect on every account is zero.
    $net = DB::table('journal_lines')->selectRaw('account_id, SUM(debit) - SUM(credit) AS net')
        ->groupBy('account_id')->pluck('net');
    expect($net->every(fn ($n) => (float) $n === 0.0))->toBeTrue();
});

it('refuses to reverse the same entry twice', function () {
    $entry = poster()->post([JournalLineData::debit('cash', 10), JournalLineData::credit('interest_income', 10)], 'x');
    poster()->reverse($entry, 'once');
    poster()->reverse($entry, 'twice');
})->throws(InvalidArgumentException::class, 'already reversed');

it('keeps the whole ledger balanced (trial balance = 0)', function () {
    foreach (range(1, 5) as $i) {
        poster()->post([
            JournalLineData::debit('cash', 1000 * $i + 0.37),
            JournalLineData::credit('pawn_loans_receivable', 1000 * $i),
            JournalLineData::credit('interest_income', 0.37),
        ], "Entry {$i}");
    }

    $totals = DB::table('journal_lines')->selectRaw('SUM(debit) d, SUM(credit) c')->first();
    expect($totals->d)->toBe($totals->c);
});
