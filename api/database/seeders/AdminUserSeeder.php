<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Creates the first super admin. The password comes from SEED_ADMIN_PASSWORD in .env
 * (never hard-coded); change it after the first login.
 */
class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $password = (string) env('SEED_ADMIN_PASSWORD', '');
        if (strlen($password) < 12) {
            throw new RuntimeException('Set SEED_ADMIN_PASSWORD (min 12 chars) in .env before seeding.');
        }

        $headOffice = DB::table('branches')->where('code', '001')->value('id');

        $user = User::query()->updateOrCreate(
            ['username' => env('SEED_ADMIN_USERNAME', 'admin')],
            [
                'branch_id' => $headOffice,
                'name' => 'System Administrator',
                'password' => $password,               // hashed by the model cast
                'is_active' => true,
            ],
        );

        $user->syncRoles(['super_admin']);

        // Super admin may work in every branch.
        foreach (DB::table('branches')->pluck('id') as $branchId) {
            DB::table('user_branches')->insertOrIgnore(['user_id' => $user->id, 'branch_id' => $branchId]);
        }
    }
}
