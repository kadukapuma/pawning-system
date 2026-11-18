<?php

namespace App\Domain\Customers\Http\Requests;

use App\Domain\Customers\Models\Customer;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Create / update customer details. Status and limits have their own endpoints. */
class CustomerRequest extends FormRequest
{
    /** Old NIC: 9 digits + V/X. New NIC: 12 digits. */
    public const NIC_REGEX = '/^([0-9]{9}[VX]|[0-9]{12})$/';

    /** Sri Lankan phone: 10 digits starting with 0. */
    public const PHONE_REGEX = '/^0[0-9]{9}$/';

    public function authorize(): bool
    {
        return $this->user()->can('customers.manage');
    }

    protected function prepareForValidation(): void
    {
        $clean = fn ($v) => is_string($v) ? preg_replace('/\s+/', ' ', trim($v)) : $v;
        $digits = fn ($v) => is_string($v) ? preg_replace('/[^0-9]/', '', $v) : $v;

        $this->merge(array_filter([
            'nic' => $this->has('nic') ? strtoupper(str_replace(' ', '', (string) $this->input('nic'))) : null,
            'phone1' => $this->has('phone1') ? $digits($this->input('phone1')) : null,
            'phone2' => $this->filled('phone2') ? $digits($this->input('phone2')) : null,
            'first_name' => $this->has('first_name') ? $clean($this->input('first_name')) : null,
            'middle_name' => $this->has('middle_name') ? $clean($this->input('middle_name')) : null,
            'last_name' => $this->has('last_name') ? $clean($this->input('last_name')) : null,
            'address_line1' => $this->has('address_line1') ? $clean($this->input('address_line1')) : null,
        ], fn ($v) => $v !== null));
    }

    public function rules(): array
    {
        /** @var Customer|null $customer */
        $customer = $this->route('customer');
        $req = $customer ? 'sometimes' : 'required';

        return [
            'title' => ['nullable', Rule::in(Customer::TITLES)],
            'first_name' => [$req, 'string', 'max:80'],
            'middle_name' => ['nullable', 'string', 'max:80'],
            'last_name' => ['nullable', 'string', 'max:80'],
            'gender' => ['nullable', Rule::in(['male', 'female', 'other'])],
            'nic' => [$req, 'string', 'regex:'.self::NIC_REGEX,
                Rule::unique('customers', 'nic')->ignore($customer?->id)],
            'driving_license' => ['nullable', 'string', 'max:30'],
            'passport' => ['nullable', 'string', 'max:30'],
            'other_identification' => ['nullable', 'string', 'max:50'],
            'date_of_birth' => ['nullable', 'date', 'before:today'],
            'address_line1' => [$req, 'string', 'max:150'],
            'address_line2' => ['nullable', 'string', 'max:150'],
            'city' => ['nullable', 'string', 'max:60'],
            'phone1' => [$req, 'string', 'regex:'.self::PHONE_REGEX],
            'phone2' => ['nullable', 'string', 'regex:'.self::PHONE_REGEX],
            'email' => ['nullable', 'email', 'max:150'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function messages(): array
    {
        return [
            'nic.regex' => 'NIC must be 9 digits followed by V or X, or 12 digits.',
            'nic.unique' => 'A customer with this NIC already exists.',
            'phone1.regex' => 'Phone must be 10 digits starting with 0.',
            'phone2.regex' => 'Phone must be 10 digits starting with 0.',
        ];
    }
}
