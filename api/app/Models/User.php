<?php

namespace App\Models;

use App\Domain\Core\Concerns\Auditable;
use App\Domain\Core\Models\Branch;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use Auditable, HasApiTokens, HasFactory, HasRoles, Notifiable, SoftDeletes;

    /** Roles that may work in every branch without a user_branches row. */
    public const ALL_BRANCH_ROLES = ['super_admin', 'head_office', 'auditor'];

    protected $fillable = [
        'branch_id',
        'username',
        'name',
        'email',
        'phone',
        'password',
        'is_active',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected array $auditExclude = ['last_login_at'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'is_active' => 'boolean',
            'password' => 'hashed',
        ];
    }

    /** Home branch. */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /** Extra branches this user may switch to. */
    public function branches(): BelongsToMany
    {
        return $this->belongsToMany(Branch::class, 'user_branches');
    }

    /** Home branch + granted branches (all active branches for head-office roles). */
    public function accessibleBranches(): Collection
    {
        if ($this->hasAnyRole(self::ALL_BRANCH_ROLES)) {
            return Branch::active()->orderBy('code')->get();
        }

        return Branch::active()
            ->where(fn ($q) => $q->whereKey($this->branch_id)
                ->orWhereIn('id', $this->branches()->select('branches.id')))
            ->orderBy('code')
            ->get();
    }

    public function canAccessBranch(int $branchId): bool
    {
        return $this->accessibleBranches()->contains('id', $branchId);
    }
}
