<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/** Company and branch details carried over from the old system. */
class CompanyAndBranchSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();

        DB::table('companies')->updateOrInsert(['id' => 1], [
            'name' => 'Sampath Pawning Center',
            'address' => 'No 194/1/1, Prime Land, Bandaranayaka Court, Nugegoda',
            'phone' => '0452288151',
            'phone2' => '0774730098',
            'email' => 'sampathn73123@gmail.com',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $branches = [
            ['code' => '001', 'name' => 'Balangoda', 'address' => 'No 03, Thanayam Pivsum Para, Balangoda', 'phone' => '0452288151', 'opened_on' => '2023-07-01'],
            ['code' => '002', 'name' => 'Rathnapura', 'address' => 'No 53, Pothgul Vihara Mawatha, Rathnapura', 'phone' => '0452230500', 'opened_on' => '2025-01-17'],
        ];

        foreach ($branches as $b) {
            DB::table('branches')->updateOrInsert(['code' => $b['code']], $b + [
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }
}
