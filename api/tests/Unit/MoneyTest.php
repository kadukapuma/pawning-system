<?php

use App\Domain\Core\Support\Money;

it('normalises to two decimals with half-up rounding', function ($in, $out) {
    expect(Money::of($in))->toBe($out);
})->with([
    ['1250', '1250.00'],
    ['1250.5', '1250.50'],
    ['10.005', '10.01'],
    ['10.004', '10.00'],
    ['-10.005', '-10.01'],
    [0.1 + 0.2, '0.30'],
    [null, '0.00'],
    ['', '0.00'],
]);

it('adds and subtracts exactly', function () {
    expect(Money::add('0.10', '0.20', 0.3))->toBe('0.60')
        ->and(Money::sub('25000', '1050.75'))->toBe('23949.25');
});

it('compares values', function () {
    expect(Money::compare('100.00', 100))->toBe(0)
        ->and(Money::isPositive('0.01'))->toBeTrue()
        ->and(Money::isNegative('-0.01'))->toBeTrue()
        ->and(Money::isZero('0.004'))->toBeTrue()
        ->and(Money::max('5', '7.5'))->toBe('7.50')
        ->and(Money::min('5', '7.5'))->toBe('5.00');
});

it('rejects non-numeric input', function () {
    Money::of('abc');
})->throws(InvalidArgumentException::class);
