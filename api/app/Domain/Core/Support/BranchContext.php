<?php

namespace App\Domain\Core\Support;

use App\Domain\Core\Models\Branch;

/**
 * The branch the current request works in. Set by the ResolveBranch middleware
 * (from the user's home branch or a validated X-Branch-Id header) and read by
 * the BelongsToBranch global scope. Registered as a scoped singleton.
 */
class BranchContext
{
    private ?Branch $branch = null;

    public function set(?Branch $branch): void
    {
        $this->branch = $branch;
    }

    public function branch(): ?Branch
    {
        return $this->branch;
    }

    public function id(): ?int
    {
        return $this->branch?->id;
    }

    public function has(): bool
    {
        return $this->branch !== null;
    }

    /** Branch id or fail — for writes that must belong to a branch. */
    public function requireId(): int
    {
        return $this->id() ?? throw new \LogicException('No branch selected for this request.');
    }

    /** Run a callback as if working in another branch (jobs, seeders, tests). */
    public function runAs(Branch $branch, callable $callback): mixed
    {
        $previous = $this->branch;
        $this->branch = $branch;

        try {
            return $callback();
        } finally {
            $this->branch = $previous;
        }
    }
}
