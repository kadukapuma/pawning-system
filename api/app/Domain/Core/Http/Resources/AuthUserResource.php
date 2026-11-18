<?php

namespace App\Domain\Core\Http\Resources;

use App\Domain\Core\Support\BranchContext;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Spatie\Permission\Models\Permission;

/**
 * The signed-in user as the SPA needs it: identity, branches it may work in,
 * roles and the flat permission list used to show/hide UI.
 *
 * @mixin \App\Models\User
 */
class AuthUserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $permissions = $this->hasRole('super_admin')
            ? Permission::pluck('name')
            : $this->getAllPermissions()->pluck('name');

        $context = app(BranchContext::class);

        return [
            'id' => $this->id,
            'username' => $this->username,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'home_branch_id' => $this->branch_id,
            'current_branch_id' => $context->id() ?? $this->branch_id,
            'branches' => BranchResource::collection($this->accessibleBranches()),
            'roles' => $this->getRoleNames()->values(),
            'permissions' => $permissions->sort()->values(),
            'last_login_at' => $this->last_login_at?->toIso8601String(),
        ];
    }
}
