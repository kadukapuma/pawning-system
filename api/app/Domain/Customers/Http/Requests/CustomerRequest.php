<?php

namespace App\Domain\Customers\Http\Requests;

use App\Domain\Customers\Models\Customer;
use App\Domain\Customers\Services\SriLankanNic;
use App\Domain\Sms\Enums\SmsType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Create / update customer details. Status and limits have their own endpoints. */
class CustomerRequest extends FormRequest
{
    private const MOBILE_REGEX = '/\A07[0-9]{8}\z/';

    /** Sri Lankan geographic area codes and the 07 mobile range. */
    private const PHONE_REGEX = '/\A0(?:11|2[134567]|3[1-8]|4[157]|5[12457]|6[3567]|7[0-9]|81|91)[0-9]{7}\z/';

    public function authorize(): bool
    {
        return $this->user()->can('customers.manage');
    }

    protected function prepareForValidation(): void
    {
        $clean = fn ($v) => is_string($v) ? preg_replace('/\s+/', ' ', trim($v)) : $v;
        $nic = $this->input('nic');
        if (is_string($nic)) {
            $nic = strtoupper(str_replace(' ', '', trim($nic)));
        }

        $this->merge(array_filter([
            'nic' => $nic,
            'phone1' => $this->normalizePhone($this->input('phone1')),
            'phone2' => $this->normalizePhone($this->input('phone2')),
            'first_name' => $this->has('first_name') ? $clean($this->input('first_name')) : null,
            'middle_name' => $this->has('middle_name') ? $clean($this->input('middle_name')) : null,
            'last_name' => $this->has('last_name') ? $clean($this->input('last_name')) : null,
            'address_line1' => $this->has('address_line1') ? $clean($this->input('address_line1')) : null,
        ], fn ($v) => $v !== null));

        if (is_string($nic) && $nic !== $this->route('customer')?->nic) {
            foreach (SriLankanNic::decode($nic) ?? [] as $field => $value) {
                if (! $this->filled($field)) {
                    $this->merge([$field => $value]);
                }
            }
        }
    }

    private function normalizePhone(mixed $value): mixed
    {
        if (! is_string($value)) {
            return $value;
        }

        $number = preg_replace('/[\s()-]+/', '', $value);
        if (preg_match('/\A\+94[1-9][0-9]{8}\z/', $number)) {
            return '0'.substr($number, 3);
        }

        return $number === '' ? $value : $number;
    }

    public function rules(): array
    {
        /** @var Customer|null $customer */
        $customer = $this->route('customer');
        $req = $customer ? 'sometimes' : 'required';
        $requiredString = $customer ? ['sometimes', 'bail', 'required', 'string'] : ['bail', 'required', 'string'];
        $nicRules = $requiredString;
        if (! $customer || $this->input('nic') !== $customer->nic) {
            $nicRules[] = function ($attribute, string $value, $fail) {
                if (SriLankanNic::decode($value) === null) {
                    $fail('Enter 9 digits followed by V or X, or 12 digits, with a valid birth date.');
                }
            };
            $nicRules[] = Rule::unique('customers', 'nic')->ignore($customer?->id);
        }

        $mobileRules = $requiredString;
        $phoneRules = ['nullable', 'string'];
        if (! $customer || $this->input('phone1') !== $customer->phone1) {
            $mobileRules[] = 'regex:'.self::MOBILE_REGEX;
        }
        if (! $customer || $this->input('phone2') !== $customer->phone2) {
            $phoneRules[] = 'regex:'.self::PHONE_REGEX;
        }

        return [
            'title' => ['nullable', Rule::in(Customer::TITLES)],
            'first_name' => [$req, 'string', 'max:80'],
            'middle_name' => ['nullable', 'string', 'max:80'],
            'last_name' => ['nullable', 'string', 'max:80'],
            'gender' => ['nullable', Rule::in(['male', 'female', 'other'])],
            'nic' => $nicRules,
            'driving_license' => ['nullable', 'string', 'max:30'],
            'passport' => ['nullable', 'string', 'max:30'],
            'other_identification' => ['nullable', 'string', 'max:50'],
            'date_of_birth' => ['nullable', 'date', 'before:today'],
            'address_line1' => [$req, 'string', 'max:150'],
            'address_line2' => ['nullable', 'string', 'max:150'],
            'city' => ['nullable', 'string', 'max:60'],
            'phone1' => $mobileRules,
            'phone2' => $phoneRules,
            'email' => ['nullable', 'email', 'max:150'],
            'sms_language' => ['nullable', Rule::in(SmsType::LANGUAGES)],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function messages(): array
    {
        return [
            'nic.unique' => 'A customer with this NIC already exists.',
            'phone1.required' => 'Enter the customer’s mobile number.',
            'phone1.regex' => 'Enter a Sri Lankan mobile number, such as 077 123 4567 or +94 77 123 4567.',
            'phone2.regex' => 'Enter a Sri Lankan mobile or landline number.',
        ];
    }
}
