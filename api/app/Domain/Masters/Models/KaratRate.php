<?php

namespace App\Domain\Masters\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Immutable: a rate change inserts a new row. All rates are per 8 g. */
class KaratRate extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'karat_id', 'effective_from', 'pawn_rate_per_8g', 'assess_rate_per_8g',
        'market_rate_per_8g', 'sale_rate_per_8g', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'effective_from' => 'datetime',
            'pawn_rate_per_8g' => 'decimal:2',
            'assess_rate_per_8g' => 'decimal:2',
            'market_rate_per_8g' => 'decimal:2',
            'sale_rate_per_8g' => 'decimal:2',
        ];
    }

    public function karat(): BelongsTo
    {
        return $this->belongsTo(Karat::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
