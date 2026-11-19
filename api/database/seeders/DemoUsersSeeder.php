<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * LOCAL DEVELOPMENT ONLY: one user per role so screens can be tested with
 * different permissions. Runs only when APP_ENV=local and SEED_DEMO_PASSWORD is set.
 */
class DemoUsersSeeder extends Seeder
{
    private const USERS = [
        // username, name, role, home branch, extra branches
        ['manager001', 'Branch Manager (001)', 'branch_manager', '001', []],
        ['manager002', 'Branch Manager (002)', 'branch_manager', '002', []],
        ['cashier001', 'Cashier (001)', 'cashier', '001', []],
        ['cashier002', 'Cashier (002)', 'cashier', '002', []],
        ['valuer001', 'Valuer (001)', 'valuer', '001', []],
        ['accountant', 'Accountant', 'accountant', '001', ['002']],
        ['auditor', 'Auditor', 'auditor', '001', []],
    ];

    public function run(): void
    {
        $password = (string) env('SEED_DEMO_PASSWORD', '');
        if (! app()->environment('local') || strlen($password) < 12) {
            $this->command?->warn('Skipping demo users (needs APP_ENV=local and SEED_DEMO_PASSWORD).');

            return;
        }

        $branches = DB::table('branches')->pluck('id', 'code');

        foreach (self::USERS as [$username, $name, $role, $home, $extra]) {
            $user = User::query()->updateOrCreate(['username' => $username], [
                'branch_id' => $branches[$home],
                'name' => $name,
                'password' => $password,
                'is_active' => true,
            ]);
            $user->syncRoles([$role]);
            $user->branches()->sync(collect($extra)->map(fn ($c) => $branches[$c])->all());
        }
    }
}
