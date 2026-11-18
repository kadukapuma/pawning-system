<?php

namespace App\Domain\Core\Http\Controllers;

use App\Domain\Core\Http\Resources\AuthUserResource;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * Session (cookie) login for the SPA via Sanctum.
 * The SPA must call GET /sanctum/csrf-cookie before POST /api/v1/auth/login.
 */
class AuthController extends Controller
{
    public function login(Request $request): AuthUserResource
    {
        $credentials = $request->validate([
            'username' => ['required', 'string', 'max:50'],
            'password' => ['required', 'string', 'max:255'],
        ]);

        $ok = Auth::guard('web')->attempt([
            'username' => $credentials['username'],
            'password' => $credentials['password'],
            'is_active' => true,
        ]);

        if (! $ok) {
            // Same message for unknown user, wrong password and inactive account.
            throw ValidationException::withMessages(['username' => 'Invalid username or password.']);
        }

        $request->session()->regenerate();

        /** @var User $user */
        $user = Auth::guard('web')->user();
        $user->forceFill(['last_login_at' => now()])->saveQuietly();
        $user->writeAudit('login');

        return new AuthUserResource($user);
    }

    public function logout(Request $request): JsonResponse
    {
        $user = $request->user();
        $user?->writeAudit('logout');

        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->json(['message' => 'Signed out.']);
    }

    public function me(Request $request): AuthUserResource
    {
        return new AuthUserResource($request->user());
    }
}
