<?php

namespace App\Domain\Customers\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Domain\Customers\Models\Customer */
class CustomerResource extends JsonResource
{
    /** Set by the controller when exposure was calculated. */
    public ?array $exposure = null;

    public function withExposure(array $exposure): static
    {
        $this->exposure = $exposure;

        return $this;
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'title' => $this->title,
            'first_name' => $this->first_name,
            'middle_name' => $this->middle_name,
            'last_name' => $this->last_name,
            'full_name' => $this->full_name,
            'gender' => $this->gender,
            'nic' => $this->nic,
            'driving_license' => $this->driving_license,
            'passport' => $this->passport,
            'other_identification' => $this->other_identification,
            'date_of_birth' => $this->date_of_birth?->toDateString(),
            'address_line1' => $this->address_line1,
            'address_line2' => $this->address_line2,
            'city' => $this->city,
            'phone1' => $this->phone1,
            'phone2' => $this->phone2,
            'email' => $this->email,
            'sms_language' => $this->sms_language,
            'status' => $this->status,
            'pawn_amount_limit' => $this->pawn_amount_limit,
            'pawn_count_limit' => $this->pawn_count_limit,
            'notes' => $this->notes,
            'branch' => $this->whenLoaded('branch', fn () => [
                'id' => $this->branch->id, 'code' => $this->branch->code, 'name' => $this->branch->name,
            ]),
            'exposure' => $this->when($this->exposure !== null, fn () => $this->exposure),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
