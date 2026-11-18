<?php

use App\Domain\Core\Services\SequenceService;
use Illuminate\Support\Facades\DB;

it('issues consecutive zero-padded numbers with the type prefix', function () {
    useBranch('001');
    $seq = app(SequenceService::class);

    expect($seq->next('part_payment'))->toBe('PP000001')
        ->and($seq->next('part_payment'))->toBe('PP000002')
        ->and($seq->next('receipt'))->toBe('000001')
        ->and($seq->peek('part_payment'))->toBe('PP000003');
});

it('keeps separate counters per branch', function () {
    $seq = app(SequenceService::class);

    expect($seq->next('receipt', branch('001')->id))->toBe('000001')
        ->and($seq->next('receipt', branch('002')->id))->toBe('000001')
        ->and($seq->next('receipt', branch('001')->id))->toBe('000002');
});

it('includes the branch code in customer codes', function () {
    expect(app(SequenceService::class)->next('customer', branch('002')->id))->toBe('C002000001');
});

it('does not consume a number when the surrounding transaction rolls back', function () {
    useBranch('001');
    $seq = app(SequenceService::class);

    try {
        DB::transaction(function () use ($seq) {
            $seq->next('redemption');
            throw new RuntimeException('save failed');
        });
    } catch (RuntimeException) {
    }

    expect($seq->next('redemption'))->toBe('RD000001');
});

it('fails loudly for an unknown document type', function () {
    useBranch('001');
    app(SequenceService::class)->next('nonsense');
})->throws(RuntimeException::class, 'No document sequence [nonsense]');
