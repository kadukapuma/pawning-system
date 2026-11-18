<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Cookie-based Sanctum auth for the React SPA (same-site, CSRF protected).
        $middleware->statefulApi();

        $middleware->alias([
            'branch' => \App\Domain\Core\Http\Middleware\ResolveBranch::class,
            'role' => \Spatie\Permission\Middleware\RoleMiddleware::class,
            'permission' => \Spatie\Permission\Middleware\PermissionMiddleware::class,
            'role_or_permission' => \Spatie\Permission\Middleware\RoleOrPermissionMiddleware::class,
        ]);

        // Set the working branch BEFORE route-model binding, so {ticket} etc.
        // are loaded through the branch scope (no reading another branch's records by id).
        $middleware->prependToPriorityList(
            before: \Illuminate\Routing\Middleware\SubstituteBindings::class,
            prepend: \App\Domain\Core\Http\Middleware\ResolveBranch::class,
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Always answer API requests with JSON errors.
        $exceptions->shouldRenderJsonWhen(
            fn ($request) => $request->is('api/*') || $request->expectsJson()
        );
    })->create();
