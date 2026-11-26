<?php

namespace App\Domain\Sms\Services;

use App\Domain\Sms\Enums\SmsType;
use App\Domain\Sms\Models\SmsSetting;
use App\Domain\Sms\Models\SmsTemplate;

/** Picks the template in the customer's language and fills the {placeholders}. */
class TemplateRenderer
{
    private const PLACEHOLDER = '/\{([a-z0-9_]+)\}/i';

    /**
     * The text to use for a customer: their language, else the company default,
     * else English. Null when none of those has been written.
     *
     * @return ?array{language: string, body: string}
     */
    public function templateFor(SmsType $type, ?string $language): ?array
    {
        $bodies = SmsTemplate::where('type', $type->value)->pluck('body', 'language')->all();

        return $this->pick($bodies, $language);
    }

    /**
     * @param  array<string, ?string>  $bodies  language => text
     * @return ?array{language: string, body: string}
     */
    public function pick(array $bodies, ?string $language): ?array
    {
        foreach ([$language, SmsSetting::current()->default_language, 'en'] as $lang) {
            if ($lang && trim((string) ($bodies[$lang] ?? '')) !== '') {
                return ['language' => $lang, 'body' => $bodies[$lang]];
            }
        }

        return null;
    }

    /** @param  array<string, string|int|null>  $values */
    public function render(string $body, array $values): string
    {
        return trim(preg_replace_callback(
            self::PLACEHOLDER,
            fn (array $m) => (string) ($values[strtolower($m[1])] ?? ''),
            $body,
        ));
    }

    /** @return list<string> placeholders in $body that this type cannot fill */
    public function unknown(string $body, SmsType $type): array
    {
        preg_match_all(self::PLACEHOLDER, $body, $m);

        return array_values(array_unique(array_diff(array_map('strtolower', $m[1]), $type->placeholders())));
    }

    /** Example values for the template preview. @return array<string, string> */
    public function sample(): array
    {
        return [
            'customer_name' => 'Mr Kamal Silva', 'first_name' => 'Kamal', 'company' => 'Sampath Pawning Center',
            'branch' => 'Balangoda', 'branch_phone' => '0452288151', 'receipt_no' => 'R000123', 'txn_no' => 'T000456',
            'date' => today()->toDateString(), 'maturity_date' => today()->addMonth()->toDateString(),
            'capital' => '40,000.00', 'interest' => '1,000.00', 'arrears' => '1,150.00', 'total_due' => '41,150.00',
            'amount_paid' => '5,000.00', 'amount_given' => '40,000.00', 'days_left' => '7', 'days_overdue' => '14',
            'promise_date' => today()->addDays(3)->toDateString(),
        ];
    }
}
