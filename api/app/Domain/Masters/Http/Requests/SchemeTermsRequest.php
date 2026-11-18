<?php

namespace App\Domain\Masters\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** Validation for a set of scheme terms (new scheme or new version). */
class SchemeTermsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('schemes.manage');
    }

    public static function termRules(): array
    {
        $money = ['required', 'numeric', 'min:0', 'max:9999999999.99'];
        $rate = ['required', 'numeric', 'min:0', 'max:100'];
        $days = ['required', 'integer', 'min:0', 'max:3650'];

        return [
            'effective_from' => ['nullable', 'date'],
            'min_amount' => $money,
            'max_amount' => ['nullable', 'numeric', 'min:0', 'max:9999999999.99'],
            'valid_days' => $days,
            'max_term_months' => ['required', 'integer', 'min:1', 'max:60'],
            'period1_days' => $days,
            'rate1' => $rate,
            'period2_days' => $days,
            'rate2' => $rate,
            'period3_days' => $days,
            'rate3' => $rate,
            'penalty_rate_monthly' => $rate,
            'service_charge' => $money,
            'service_charge_below_threshold' => $money,
            'service_charge_above_percent' => $rate,
            'service_charge_threshold' => $money,
            'document_charge' => $money,
            'stamp_duty' => $money,
            'postage_charge' => $money,
            'letter_1_days' => $days,
            'letter_2_days' => $days,
            'letter_3_days' => $days,
            'forfeit_reminder_days' => $days,
            'min_capital_after_part_payment' => $money,
        ];
    }

    public function rules(): array
    {
        return self::termRules();
    }
}
