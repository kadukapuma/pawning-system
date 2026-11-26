<?php

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

function newUserPayload(array $o = []): array
{
    return $o + [
        'username' => 'kumari',
        'name' => 'Kumari Silva',
        'password' => 'Cashier-2026x',
        'branch_id' => branch('001')->id,
        'role' => 'cashier',
        'branch_ids' => [branch('002')->id],
    ];
}

it('creates a user with a role and extra branches', function () {
    $admin = User::where('username', 'admin')->first();

    $this->actingAs($admin)->withHeaders(spaHeaders())->postJson('/api/v1/admin/users', newUserPayload())
        ->assertCreated()
        ->assertJsonPath('data.role', 'cashier')
        ->assertJsonPath('data.branch.code', '001')
        ->assertJsonPath('data.branch_ids', [branch('002')->id]);

    $user = User::where('username', 'kumari')->first();
    expect(Hash::check('Cashier-2026x', $user->password))->toBeTrue()
        ->and($user->accessibleBranches()->pluck('code')->all())->toBe(['001', '002']);
});

it('requires a strong password', function () {
    $this->actingAs(User::where('username', 'admin')->first())->withHeaders(spaHeaders())
        ->postJson('/api/v1/admin/users', newUserPayload(['password' => 'short']))
        ->assertStatus(422)->assertJsonValidationErrors('password');
});

it('stops non-super-admins from creating super admins and others from managing users', function () {
    $this->actingAs(userWithRole('head_office'))->withHeaders(spaHeaders())
        ->postJson('/api/v1/admin/users', newUserPayload())->assertForbidden();   // head_office lacks users.manage

    $this->actingAs(userWithRole('cashier'))->withHeaders(spaHeaders())
        ->getJson('/api/v1/admin/users')->assertForbidden();
});

it('prevents an admin from deactivating themselves', function () {
    $admin = User::where('username', 'admin')->first();

    $this->actingAs($admin)->withHeaders(spaHeaders())
        ->putJson("/api/v1/admin/users/{$admin->id}", [
            'name' => $admin->name, 'branch_id' => $admin->branch_id, 'role' => 'super_admin', 'is_active' => false,
        ])->assertStatus(422);
});

it('resets a password and audits it without storing the password', function () {
    $admin = User::where('username', 'admin')->first();
    $target = userWithRole('cashier');

    $this->actingAs($admin)->withHeaders(spaHeaders())
        ->putJson("/api/v1/admin/users/{$target->id}/password", ['password' => 'NewPass-2026x'])->assertOk();

    expect(Hash::check('NewPass-2026x', $target->fresh()->password))->toBeTrue();
    $log = DB::table('audit_logs')->where('auditable_id', $target->id)->where('event', 'password_reset')->first();
    expect($log)->not->toBeNull()->and($log->new_values)->toBeNull();
});

it('creates a branch with its own document counters, and keeps codes permanent', function () {
    $admin = User::where('username', 'admin')->first();

    $id = $this->actingAs($admin)->withHeaders(spaHeaders())
        ->postJson('/api/v1/admin/branches', ['code' => '003', 'name' => 'Embilipitiya'])
        ->assertCreated()->json('data.id');

    expect(DB::table('document_sequences')->where('branch_id', $id)->count())->toBeGreaterThan(20);

    $this->actingAs($admin)->withHeaders(spaHeaders())
        ->putJson("/api/v1/admin/branches/{$id}", ['code' => '004', 'name' => 'Embilipitiya'])
        ->assertStatus(422)->assertJsonValidationErrors('code');
});

it('lists roles with their permissions for user admins', function () {
    $this->actingAs(User::where('username', 'admin')->first())->withHeaders(spaHeaders())
        ->getJson('/api/v1/admin/roles')
        ->assertOk()
        ->assertJsonCount(7, 'data')
        ->assertJsonCount(43, 'meta.all_permissions')
        ->assertJsonPath('data.6.name', 'valuer');
});

it('lets auditors read the audit log', function () {
    $this->actingAs(User::where('username', 'admin')->first())->withHeaders(spaHeaders())
        ->postJson('/api/v1/admin/branches', ['code' => '003', 'name' => 'Embilipitiya'])->assertCreated();

    $this->actingAs(userWithRole('auditor'))->withHeaders(spaHeaders())
        ->getJson('/api/v1/admin/audit-logs?type=branch&event=created')
        ->assertOk()->assertJsonPath('data.0.new_values.name', 'Embilipitiya');

    $this->actingAs(userWithRole('cashier'))->withHeaders(spaHeaders())
        ->getJson('/api/v1/admin/audit-logs')->assertForbidden();
});
