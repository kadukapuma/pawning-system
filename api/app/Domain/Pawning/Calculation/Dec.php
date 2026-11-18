<?php

namespace App\Domain\Pawning\Calculation;

use App\Domain\Core\Support\Money;

/**
 * Exact intermediate arithmetic for the calculation engine (bcmath, scale 10).
 * Results are rounded to money (2 dp, half-up) only at the end via Money::of().
 */
final class Dec
{
    public const SCALE = 10;

    public static function n(string|int|float|null $v): string
    {
        if ($v === null || $v === '') {
            return '0';
        }

        return is_float($v) ? sprintf('%.10F', $v) : (string) $v;
    }

    public static function add(string|int|float|null ...$v): string
    {
        return array_reduce($v, fn ($c, $x) => bcadd($c, self::n($x), self::SCALE), '0');
    }

    public static function sub(string|int|float|null $a, string|int|float|null $b): string
    {
        return bcsub(self::n($a), self::n($b), self::SCALE);
    }

    public static function mul(string|int|float|null $a, string|int|float|null $b): string
    {
        return bcmul(self::n($a), self::n($b), self::SCALE);
    }

    public static function div(string|int|float|null $a, string|int|float|null $b): string
    {
        return bcdiv(self::n($a), self::n($b), self::SCALE);
    }

    /** $rate percent of $amount. */
    public static function pct(string|int|float|null $amount, string|int|float|null $rate): string
    {
        return self::div(self::mul($amount, $rate), 100);
    }

    public static function max(string|int|float|null $a, string|int|float|null $b): string
    {
        return bccomp(self::n($a), self::n($b), self::SCALE) >= 0 ? self::n($a) : self::n($b);
    }

    public static function min(string|int|float|null $a, string|int|float|null $b): string
    {
        return bccomp(self::n($a), self::n($b), self::SCALE) <= 0 ? self::n($a) : self::n($b);
    }

    /** max(0, $v). */
    public static function pos(string|int|float|null $v): string
    {
        return self::max($v, '0');
    }

    public static function cmp(string|int|float|null $a, string|int|float|null $b): int
    {
        return bccomp(self::n($a), self::n($b), self::SCALE);
    }

    public static function money(string|int|float|null $v): string
    {
        return Money::of($v);
    }
}
