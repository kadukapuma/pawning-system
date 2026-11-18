<?php

use App\Domain\Core\Models\Branch;
use App\Domain\Core\Support\BranchContext;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

/*
| Helpers shared by feature tests. Reference data (branches 001/002, roles,
| accounts, sequences) is seeded before each test by TestCase::$seed.
*/

function branch(string $code = '001'): Branch
{
    return Branch::where('code', $code)->firstOrFail();
}

/** A user with one role whose home branch is $branchCode. */
function userWithRole(string $role, string $branchCode = '001', array $attributes = []): User
{
    $user = User::factory()->create(['branch_id' => branch($branchCode)->id] + $attributes);
    $user->assignRole($role);

    // Reload so every column is present, as it is for a real authenticated request.
    return $user->fresh();
}

/** Make $code the working branch for code that runs outside an HTTP request. */
function useBranch(string $code = '001'): Branch
{
    $branch = branch($code);
    app(BranchContext::class)->set($branch);

    return $branch;
}

/** Headers that make Sanctum treat the request as coming from the SPA (session cookie auth). */
function spaHeaders(array $extra = []): array
{
    return ['Referer' => 'http://localhost:5173/', 'Accept' => 'application/json'] + $extra;
}
