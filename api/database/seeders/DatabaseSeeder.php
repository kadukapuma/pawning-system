<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Reference data only — the new system starts with no customers or tickets.
     */
    public function run(): void
    {
        $this->call([
            RolesAndPermissionsSeeder::class,
            CompanyAndBranchSeeder::class,
            AdminUserSeeder::class,
            MasterDataSeeder::class,
            PawnSchemeSeeder::class,
            ChartOfAccountsSeeder::class,
            DocumentSequenceSeeder::class,
            SmsSeeder::class,                  // everything switched off
            DemoUsersSeeder::class,            // local only
        ]);
    }
}
