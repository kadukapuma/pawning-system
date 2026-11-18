<?php

namespace App\Domain\Core\Concerns;

use App\Domain\Core\Models\Branch;
use App\Domain\Core\Support\BranchContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Branch isolation for branch-owned models.
 *
 * - Reads are limited to the current branch (global scope "branch").
 *   Use Model::withoutBranchScope() for cross-branch reports.
 * - New rows get branch_id from the current branch when not set.
 */
trait BelongsToBranch
{
    public static function bootBelongsToBranch(): void
    {
        static::addGlobalScope('branch', function (Builder $query) {
            $branchId = app(BranchContext::class)->id();
            if ($branchId !== null) {
                $query->where($query->getModel()->qualifyColumn('branch_id'), $branchId);
            }
        });

        static::creating(function ($model) {
            if (empty($model->branch_id)) {
                $model->branch_id = app(BranchContext::class)->requireId();
            }
        });
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public static function withoutBranchScope(): Builder
    {
        return static::query()->withoutGlobalScope('branch');
    }
}
