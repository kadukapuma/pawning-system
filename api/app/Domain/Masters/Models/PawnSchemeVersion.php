<?php

namespace App\Domain\Masters\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Immutable terms of a scheme for a date range. Never update the terms of a
 * saved version — use SchemeVersionService to close it and add a new one.
 */
class PawnSchemeVersion extends Model
{
    public const UPDATED_AT = null;

    /** Editable terms (everything except keys and audit columns). */
    public const TERMS = [
        'min_amount', 'max_amount', 'valid_days', 'max_term_months',
        'period1_days', 'rate1', 'period2_days', 'rate2', 'period3_days', 'rate3', 'penalty_rate_monthly',
        'service_charge', 'service_charge_below_threshold', 'service_charge_above_percent', 'service_charge_threshold',
        'document_charge', 'stamp_duty', 'postage_charge',
        'letter_1_days', 'letter_2_days', 'letter_3_days', 'forfeit_reminder_days',
        'min_capital_after_part_payment',
    ];

    protected $fillable = ['scheme_id', 'effective_from', 'effective_to', 'created_by', ...self::TERMS];

    protected function casts(): array
    {
        return [
            'effective_from' => 'date',
            'effective_to' => 'date',
            'min_amount' => 'decimal:2',
            'max_amount' => 'decimal:2',
            'rate1' => 'decimal:4',
            'rate2' => 'decimal:4',
            'rate3' => 'decimal:4',
            'penalty_rate_monthly' => 'decimal:4',
            'service_charge' => 'decimal:2',
            'service_charge_below_threshold' => 'decimal:2',
            'service_charge_above_percent' => 'decimal:4',
            'service_charge_threshold' => 'decimal:2',
            'document_charge' => 'decimal:2',
            'stamp_duty' => 'decimal:2',
            'postage_charge' => 'decimal:2',
            'min_capital_after_part_payment' => 'decimal:2',
            'valid_days' => 'integer',
            'max_term_months' => 'integer',
            'period1_days' => 'integer',
            'period2_days' => 'integer',
            'period3_days' => 'integer',
            'letter_1_days' => 'integer',
            'letter_2_days' => 'integer',
            'letter_3_days' => 'integer',
            'forfeit_reminder_days' => 'integer',
        ];
    }

    public function scheme(): BelongsTo
    {
        return $this->belongsTo(PawnScheme::class, 'scheme_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** Versions in force on a date (latest first). */
    public function scopeEffectiveOn(Builder $query, string $date): Builder
    {
        return $query->where('effective_from', '<=', $date)
            ->where(fn ($q) => $q->whereNull('effective_to')->orWhere('effective_to', '>=', $date))
            ->orderByDesc('effective_from')->orderByDesc('id');
    }
}
