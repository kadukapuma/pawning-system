<?php

namespace App\Domain\Sms\Services;

use App\Domain\Core\Models\Branch;
use App\Domain\Core\Models\Company;
use App\Domain\Customers\Models\Customer;

/** Placeholder values shared by every message. */
class SmsValues
{
    private ?string $company = null;

    /** @return array<string, string> */
    public function for(Customer $customer, ?Branch $branch): array
    {
        $this->company ??= Company::current()->name;

        return [
            'customer_name' => trim(($customer->title ? $customer->title.' ' : '').$customer->full_name),
            'first_name' => $customer->first_name,
            'company' => $this->company,
            'branch' => (string) $branch?->name,
            'branch_phone' => (string) $branch?->phone,
        ];
    }

    public static function money(string|int|float|null $amount): string
    {
        return number_format((float) $amount, 2);
    }
}
