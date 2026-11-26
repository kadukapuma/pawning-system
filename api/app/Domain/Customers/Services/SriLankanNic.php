<?php

namespace App\Domain\Customers\Services;

use DateTimeImmutable;

class SriLankanNic
{
    /** @return array{date_of_birth: string, gender: 'male'|'female'}|null */
    public static function decode(string $nic): ?array
    {
        if (! preg_match('/\A(?:[0-9]{9}[VX]|[0-9]{12})\z/', $nic)) {
            return null;
        }

        $yearLength = strlen($nic) === 10 ? 2 : 4;
        $year = (int) substr($nic, 0, $yearLength) + ($yearLength === 2 ? 1900 : 0);
        $day = (int) substr($nic, $yearLength, 3);
        $gender = $day > 500 ? 'female' : 'male';
        $day -= $gender === 'female' ? 500 : 0;
        if ($year === 0 || $day < 1 || $day > 366) {
            return null;
        }

        // NIC day codes reserve a slot for 29 February every year.
        $calendar = new DateTimeImmutable('2000-01-01');
        $monthDay = $calendar->modify('+'.($day - 1).' days');
        if (! checkdate((int) $monthDay->format('m'), (int) $monthDay->format('d'), $year)) {
            return null;
        }

        $birthDate = sprintf('%04d-%s', $year, $monthDay->format('m-d'));
        if ($birthDate >= today()->toDateString()) {
            return null;
        }

        return ['date_of_birth' => $birthDate, 'gender' => $gender];
    }
}
