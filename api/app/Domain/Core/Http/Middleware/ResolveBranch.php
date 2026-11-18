<?php

namespace App\Domain\Core\Http\Middleware;

use App\Domain\Core\Models\Branch;
use App\Domain\Core\Support\BranchContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sets the working branch for the request.
 * Header X-Branch-Id selects another branch the user is allowed to access;
 * otherwise the user's home branch is used.
 */
class ResolveBranch
{
    public function __construct(private BranchContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if ($user === null) {
            return $next($request);
        }

        $requested = $request->header('X-Branch-Id');
        $branchId = $requested !== null && $requested !== '' ? (int) $requested : (int) $user->branch_id;

        if (! $user->canAccessBranch($branchId)) {
            return response()->json(['message' => 'You do not have access to this branch.'], 403);
        }

        $this->context->set(Branch::findOrFail($branchId));

        return $next($request);
    }
}
