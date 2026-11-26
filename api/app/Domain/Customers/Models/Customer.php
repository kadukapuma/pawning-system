<?php

namespace App\Domain\Customers\Models;

use App\Domain\Core\Concerns\Auditable;
use App\Domain\Core\Models\Branch;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One record per person across all branches (unique NIC). Not branch-scoped:
 * branch_id records where the customer was registered.
 */
class Customer extends Model
{
    use Auditable, SoftDeletes;

    public const STATUS_ACTIVE = 'active';

    public const STATUS_INACTIVE = 'inactive';

    public const STATUS_BLACKLISTED = 'blacklisted';

    public const STATUSES = [self::STATUS_ACTIVE, self::STATUS_INACTIVE, self::STATUS_BLACKLISTED];

    public const TITLES = ['Mr', 'Mrs', 'Miss', 'Ms', 'Rev', 'Dr'];

    /** Mirror the column default so new in-memory models are consistent. */
    protected $attributes = ['status' => self::STATUS_ACTIVE];

    protected $fillable = [
        'branch_id', 'code', 'title', 'first_name', 'middle_name', 'last_name', 'gender', 'nic',
        'driving_license', 'passport', 'other_identification', 'date_of_birth',
        'address_line1', 'address_line2', 'city', 'phone1', 'phone2', 'email', 'sms_language', 'photo_path',
        'status', 'pawn_amount_limit', 'pawn_count_limit', 'notes', 'created_by', 'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'date_of_birth' => 'date',
            'pawn_amount_limit' => 'decimal:2',
            'pawn_count_limit' => 'integer',
        ];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** Search by NIC, code, phone or name. */
    public function scopeSearch(Builder $query, ?string $term): Builder
    {
        $term = trim((string) $term);
        if ($term === '') {
            return $query;
        }

        $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $term).'%';

        return $query->where(fn (Builder $q) => $q
            ->where('nic', 'like', strtoupper($term).'%')
            ->orWhere('code', 'like', strtoupper($term).'%')
            ->orWhere('phone1', 'like', $term.'%')
            ->orWhere('phone2', 'like', $term.'%')
            ->orWhere('full_name', 'like', $like));
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }
}
