<?php

namespace App\Domain\Core\Support;

use InvalidArgumentException;

/**
 * Exact decimal money arithmetic (bcmath, 2 dp). Values are strings like "1250.00".
 * Never use PHP floats for money.
 */
final class Money
{
    public const SCALE = 2;

    /** Normalise any numeric input to a 2-dp string, rounding half away from zero. */
    public static function of(string|int|float|null $value): string
    {
        if ($value === null || $value === '') {
            return '0.00';
        }
        $value = is_float($value) ? sprintf('%.6F', $value) : trim((string) $value);
        if (! is_numeric($value)) {
            throw new InvalidArgumentException("Not a money value: [{$value}]");
        }

        $half = str_starts_with($value, '-') ? '-0.005' : '0.005';

        return bcadd(bcadd($value, $half, 6), '0', self::SCALE);
    }

    public static function add(string|int|float|null ...$values): string
    {
        $sum = '0.00';
        foreach ($values as $v) {
            $sum = bcadd($sum, self::of($v), self::SCALE);
        }

        return $sum;
    }

    public static function sub(string|int|float|null $a, string|int|float|null $b): string
    {
        return bcsub(self::of($a), self::of($b), self::SCALE);
    }

    /** -1, 0 or 1. */
    public static function compare(string|int|float|null $a, string|int|float|null $b): int
    {
        return bccomp(self::of($a), self::of($b), self::SCALE);
    }

    public static function isZero(string|int|float|null $value): bool
    {
        return self::compare($value, 0) === 0;
    }

    public static function isPositive(string|int|float|null $value): bool
    {
        return self::compare($value, 0) === 1;
    }

    public static function isNegative(string|int|float|null $value): bool
    {
        return self::compare($value, 0) === -1;
    }

    public static function max(string|int|float|null $a, string|int|float|null $b): string
    {
        return self::compare($a, $b) >= 0 ? self::of($a) : self::of($b);
    }

    public static function min(string|int|float|null $a, string|int|float|null $b): string
    {
        return self::compare($a, $b) <= 0 ? self::of($a) : self::of($b);
    }
}
