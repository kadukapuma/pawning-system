<?php

namespace App\Domain\Core\Http\Controllers;

use App\Domain\Core\Models\AuditLog;
use App\Domain\Core\Support\BranchContext;
use App\Http\Controllers\Controller;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Spatie\Permission\Models\Role;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/** User accounts. Users are never deleted — deactivate them instead. */
class UserAdminController extends Controller
{
    public function index(Request $request): JsonResource
    {
        $this->authorize('users.manage');
        $q = trim((string) $request->query('q', ''));

        $users = User::query()
            ->with(['branch:id,code,name', 'branches:id,code,name', 'roles:id,name'])
            ->when($q !== '', fn ($query) => $query->where(fn ($w) => $w
                ->where('username', 'like', "%{$q}%")->orWhere('name', 'like', "%{$q}%")))
            ->orderBy('username')
            ->get();

        return JsonResource::collection($users->map(fn (User $u) => $this->present($u)));
    }

    /** Roles with their permissions. Roles themselves are fixed (RolesAndPermissionsSeeder); their permissions are editable. */
    public function roles(Request $request): JsonResource
    {
        $this->authorize('users.manage');

        $counts = DB::table('model_has_roles')->where('model_type', 'user')
            ->selectRaw('role_id, COUNT(*) AS c')->groupBy('role_id')->pluck('c', 'role_id');
        $actor = $request->user();

        return JsonResource::collection(
            Role::with('permissions:id,name')->orderBy('name')->get()
                ->map(fn (Role $r) => [
                    'name' => $r->name,
                    'users_count' => (int) ($counts[$r->id] ?? 0),
                    'permissions' => $r->permissions->pluck('name')->sort()->values(),
                    'editable' => $this->roleEditBlocker($actor, $r) === null,
                ])
        )->additional(['meta' => ['all_permissions' => RolesAndPermissionsSeeder::PERMISSIONS]]);
    }

    /** Replace a role's permission set. */
    public function updateRole(Request $request, Role $role): JsonResource
    {
        $this->authorize('users.manage');
        $data = $request->validate([
            'permissions' => ['present', 'array'],
            'permissions.*' => ['string', 'distinct', Rule::in(RolesAndPermissionsSeeder::PERMISSIONS)],
        ]);

        if ($reason = $this->roleEditBlocker($request->user(), $role)) {
            throw ValidationException::withMessages(['permissions' => $reason]);
        }

        $old = $role->permissions()->pluck('name')->sort()->values()->all();
        $new = collect($data['permissions'])->sort()->values()->all();

        if ($old !== $new) {
            DB::transaction(function () use ($role, $old, $new) {
                $role->syncPermissions($new);
                AuditLog::create([
                    'user_id' => auth()->id(),
                    'branch_id' => app(BranchContext::class)->id(),
                    'auditable_type' => $role->getMorphClass(),
                    'auditable_id' => $role->getKey(),
                    'event' => 'permissions_changed',
                    'old_values' => ['role' => $role->name, 'removed' => array_values(array_diff($old, $new))],
                    'new_values' => ['role' => $role->name, 'added' => array_values(array_diff($new, $old))],
                    'ip_address' => request()->ip(),
                    'user_agent' => substr((string) request()->userAgent(), 0, 255),
                ]);
            });
        }

        return new JsonResource([
            'name' => $role->name,
            'permissions' => $role->fresh('permissions')->permissions->pluck('name')->sort()->values(),
        ]);
    }

    /**
     * Why $actor may not edit $role, or null when allowed.
     * super_admin always has everything; nobody edits their own role (no self-escalation or lock-out).
     */
    private function roleEditBlocker(User $actor, Role $role): ?string
    {
        if ($role->name === 'super_admin') {
            return 'Super admin always has every permission.';
        }
        if ($actor->hasRole($role->name)) {
            return 'You cannot change the permissions of your own role.';
        }

        return null;
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorize('users.manage');
        $data = $request->validate($this->rules() + [
            'username' => ['required', 'string', 'min:3', 'max:50', 'alpha_dash', 'unique:users,username'],
            'password' => ['required', 'string', Password::min(10)->letters()->numbers()],
        ]);
        $this->guardRole($request->user(), $data['role']);

        $user = DB::transaction(function () use ($data) {
            $user = User::create([
                'branch_id' => $data['branch_id'],
                'username' => strtolower($data['username']),
                'name' => $data['name'],
                'email' => $data['email'] ?? null,
                'phone' => $data['phone'] ?? null,
                'password' => $data['password'],
                'is_active' => $data['is_active'] ?? true,
            ]);
            $user->syncRoles([$data['role']]);
            $user->branches()->sync($data['branch_ids'] ?? []);

            return $user;
        });

        return (new JsonResource($this->present($user->fresh())))->response()->setStatusCode(201);
    }

    public function update(Request $request, User $user): JsonResource
    {
        $this->authorize('users.manage');
        $data = $request->validate($this->rules($user));
        $actor = $request->user();
        $this->guardRole($actor, $data['role'], $user);

        if ($actor->is($user) && (! ($data['is_active'] ?? true) || ! $user->hasRole($data['role']))) {
            throw ValidationException::withMessages(['role' => 'You cannot change your own role or deactivate yourself.']);
        }

        DB::transaction(function () use ($user, $data) {
            $user->update([
                'branch_id' => $data['branch_id'],
                'name' => $data['name'],
                'email' => $data['email'] ?? null,
                'phone' => $data['phone'] ?? null,
                'is_active' => $data['is_active'] ?? $user->is_active,
            ]);
            if (! $user->hasRole($data['role'])) {
                $old = $user->getRoleNames()->all();
                $user->syncRoles([$data['role']]);
                $user->writeAudit('role_changed', ['roles' => $old], ['roles' => [$data['role']]]);
            }
            $user->branches()->sync($data['branch_ids'] ?? []);
        });

        return new JsonResource($this->present($user->fresh()));
    }

    public function resetPassword(Request $request, User $user): JsonResource
    {
        $this->authorize('users.manage');
        $data = $request->validate(['password' => ['required', 'string', Password::min(10)->letters()->numbers()]]);

        $user->forceFill(['password' => $data['password'], 'remember_token' => null])->saveQuietly();
        $user->writeAudit('password_reset');

        return new JsonResource($this->present($user->fresh()));
    }

    private function rules(?User $user = null): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'email' => ['nullable', 'email', 'max:150', Rule::unique('users', 'email')->ignore($user?->id)],
            'phone' => ['nullable', 'string', 'max:20'],
            'branch_id' => ['required', 'integer', 'exists:branches,id'],
            'branch_ids' => ['nullable', 'array'],
            'branch_ids.*' => ['integer', 'exists:branches,id'],
            'role' => ['required', 'string', 'exists:roles,name'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /** Only a super admin may create or edit super admins. */
    private function guardRole(User $actor, string $role, ?User $target = null): void
    {
        $touchesSuper = $role === 'super_admin' || $target?->hasRole('super_admin');
        if ($touchesSuper && ! $actor->hasRole('super_admin')) {
            throw ValidationException::withMessages(['role' => 'Only a super admin can manage super admin accounts.']);
        }
    }

    private function present(User $u): array
    {
        $u->loadMissing(['branch:id,code,name', 'branches:id,code,name', 'roles:id,name']);

        return [
            'id' => $u->id,
            'username' => $u->username,
            'name' => $u->name,
            'email' => $u->email,
            'phone' => $u->phone,
            'is_active' => $u->is_active,
            'role' => $u->roles->first()?->name,
            'branch' => $u->branch ? ['id' => $u->branch->id, 'code' => $u->branch->code, 'name' => $u->branch->name] : null,
            'branch_ids' => $u->branches->pluck('id')->values(),
            'last_login_at' => $u->last_login_at?->toIso8601String(),
        ];
    }
}
