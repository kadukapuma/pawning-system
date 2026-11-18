<?php

namespace App\Domain\Core\Models;

use App\Domain\Core\Concerns\Auditable;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Branch extends Model
{
    use Auditable, SoftDeletes;

    protected $fillable = ['code', 'name', 'address', 'phone', 'phone2', 'opened_on', 'is_active'];

    protected function casts(): array
    {
        return ['opened_on' => 'date', 'is_active' => 'boolean'];
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }
}
