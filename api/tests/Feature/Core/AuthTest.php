<?php

use App\Domain\Core\Models\AuditLog;
use App\Models\User;
use Illuminate\Support\Facades\RateLimiter;

beforeEach(fn () => RateLimiter::clear('login'));

it('signs in with username and password and returns the SPA profile', function () {
    $user = userWithRole('cashier', '001', ['username' => 'nimal', 'password' => 'Secret-pass-123']);

    $response = $this->withHeaders(spaHeaders())
        ->postJson('/api/v1/auth/login', ['username' => 'nimal', 'password' => 'Secret-pass-123']);

    $response->assertOk()
        ->assertJsonPath('data.username', 'nimal')
        ->assertJsonPath('data.current_branch_id', branch('001')->id)
        ->assertJsonPath('data.roles', ['cashier'])
        ->assertJsonCount(1, 'data.branches');

    expect($response->json('data.permissions'))->toContain('pawn.create')->not->toContain('pawn.block');
    expect($user->fresh()->last_login_at)->not->toBeNull();
    expect(AuditLog::where('auditable_id', $user->id)->where('event', 'login')->exists())->toBeTrue();
    $this->assertAuthenticatedAs($user, 'web');
});

it('rejects a wrong password with a generic message', function () {
    userWithRole('cashier', '001', ['username' => 'nimal', 'password' => 'Secret-pass-123']);

    $this->withHeaders(spaHeaders())
        ->postJson('/api/v1/auth/login', ['username' => 'nimal', 'password' => 'wrong'])
        ->assertStatus(422)
        ->assertJsonPath('errors.username.0', 'Invalid username or password.');

    $this->assertGuest('web');
});

it('rejects an inactive user with the same generic message', function () {
    userWithRole('cashier', '001', ['username' => 'old', 'password' => 'Secret-pass-123', 'is_active' => false]);

    $this->withHeaders(spaHeaders())
        ->postJson('/api/v1/auth/login', ['username' => 'old', 'password' => 'Secret-pass-123'])
        ->assertStatus(422)
        ->assertJsonPath('errors.username.0', 'Invalid username or password.');
});

it('throttles repeated failed logins', function () {
    userWithRole('cashier', '001', ['username' => 'nimal', 'password' => 'Secret-pass-123']);

    foreach (range(1, 5) as $_) {
        $this->withHeaders(spaHeaders())->postJson('/api/v1/auth/login', ['username' => 'nimal', 'password' => 'x'])->assertStatus(422);
    }

    $this->withHeaders(spaHeaders())
        ->postJson('/api/v1/auth/login', ['username' => 'nimal', 'password' => 'Secret-pass-123'])
        ->assertStatus(429);
});

it('requires authentication for protected endpoints', function () {
    $this->withHeaders(spaHeaders())->getJson('/api/v1/auth/me')->assertUnauthorized();
});

it('signs out', function () {
    userWithRole('cashier', '001', ['username' => 'nimal', 'password' => 'Secret-pass-123']);
    $this->withHeaders(spaHeaders())->postJson('/api/v1/auth/login', ['username' => 'nimal', 'password' => 'Secret-pass-123'])->assertOk();

    $this->withHeaders(spaHeaders())->postJson('/api/v1/auth/logout')->assertOk();

    $this->assertGuest('web');
});

it('gives super admin every permission', function () {
    $admin = User::where('username', 'admin')->firstOrFail();

    $this->actingAs($admin)->withHeaders(spaHeaders())->getJson('/api/v1/auth/me')
        ->assertOk()
        ->assertJsonCount(44, 'data.permissions')
        ->assertJsonCount(2, 'data.branches');

    expect($admin->can('forfeit.execute'))->toBeTrue();
});
