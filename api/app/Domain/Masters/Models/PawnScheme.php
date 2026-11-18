<?php

namespace App\Domain\Masters\Models;

use App\Domain\Core\Concerns\Auditable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/** Receipt type: A / B / C (by amount band) or SILVER. Terms live in versions. */
class PawnScheme extends Model
{
    use Auditable;

    public const METHOD_TIERED = 'tiered';

    public const METHOD_MONTHLY_PENALTY = 'monthly_penalty';

    public const METHOD_SILVER = 'silver';

    public const METHODS = [self::METHOD_TIERED, self::METHOD_MONTHLY_PENALTY, self::METHOD_SILVER];

    protected $fillable = ['code', 'name', 'metal', 'interest_method', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function versions(): HasMany
    {
        return $this->hasMany(PawnSchemeVersion::class, 'scheme_id')
            ->orderByDesc('effective_from')->orderByDesc('id');
    }

    /** The open-ended (latest) version. */
    public function currentVersion(): HasOne
    {
        return $this->hasOne(PawnSchemeVersion::class, 'scheme_id')->ofMany(
            ['effective_from' => 'max', 'id' => 'max'],
            fn (Builder $q) => $q->whereNull('effective_to'),
        );
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }
}
