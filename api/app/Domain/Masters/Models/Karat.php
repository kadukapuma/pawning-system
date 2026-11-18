<?php

namespace App\Domain\Masters\Models;

use App\Domain\Core\Concerns\Auditable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/** A rate grade (e.g. "B4 - 22KT"). Rates are versioned in karat_rates. */
class Karat extends Model
{
    use Auditable;

    protected $fillable = ['code', 'name', 'metal', 'purity_karat', 'sort_order', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'purity_karat' => 'decimal:2', 'sort_order' => 'integer'];
    }

    public function rates(): HasMany
    {
        return $this->hasMany(KaratRate::class)->orderByDesc('effective_from')->orderByDesc('id');
    }

    /** Rate in force now (latest effective_from <= now). */
    public function currentRate(): HasOne
    {
        return $this->hasOne(KaratRate::class)->ofMany(
            ['effective_from' => 'max', 'id' => 'max'],
            fn (Builder $q) => $q->where('effective_from', '<=', now()),
        );
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }

    public function scopeOrdered(Builder $query): Builder
    {
        return $query->orderBy('sort_order')->orderBy('code');
    }
}
