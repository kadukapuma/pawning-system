<?php

namespace App\Domain\Core\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Models\User;
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

    /** Roles with their permissions (read-only; roles are defined in RolesAndPermissionsSeeder). */
    public function roles(): JsonResource
    {
        $this->authorize('users.manage');

        $counts = DB::table('model_has_roles')->where('model_type', 'user')
            ->selectRaw('role_id, COUNT(*) AS c')->groupBy('role_id')->pluck('c', 'role_id');

        return JsonResource::collection(
            \Spatie\Permission\Models\Role::with('permissions:id,name')->orderBy('name')->get()
                ->map(fn ($r) => [
                    'name' => $r->name,
                    'users_count' => (int) ($counts[$r->id] ?? 0),
                    'permissions' => $r->permissions->pluck('name')->sort()->values(),
                ])
        )->additional(['meta' => ['all_permissions' => \Database\Seeders\RolesAndPermissionsSeeder::PERMISSIONS]]);
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
