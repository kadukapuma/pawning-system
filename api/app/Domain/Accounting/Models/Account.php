<?php

namespace App\Domain\Accounting\Models;

use App\Domain\Core\Concerns\Auditable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use RuntimeException;

class Account extends Model
{
    use Auditable;

    protected $fillable = [
        'code', 'name', 'account_group_id', 'type', 'normal_balance', 'branch_id',
        'is_cash', 'is_bank', 'is_system', 'system_key', 'opening_balance', 'is_active',
    ];

    protected function casts(): array
    {
        return [
            'is_cash' => 'boolean',
            'is_bank' => 'boolean',
            'is_system' => 'boolean',
            'is_active' => 'boolean',
            'opening_balance' => 'decimal:2',
        ];
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(AccountGroup::class, 'account_group_id');
    }

    public function lines(): HasMany
    {
        return $this->hasMany(JournalLine::class);
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }

    /** Find a system account by its key (cash, pawn_loans_receivable, ...). */
    public static function system(string $key): self
    {
        return static::query()->where('system_key', $key)->first()
            ?? throw new RuntimeException("System account [{$key}] is not configured.");
    }
}
