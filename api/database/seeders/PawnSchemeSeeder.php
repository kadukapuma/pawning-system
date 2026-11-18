<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Receipt types A / B / C / SILVER with the terms active in the old system
 * on 2026-10-06 (recei__adds rows 25, 28, 26, 27).
 */
class PawnSchemeSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();

        $schemes = [
            [
                'scheme' => ['code' => 'A', 'name' => 'Type A (below Rs. 50,000)', 'metal' => 'gold', 'interest_method' => 'tiered'],
                'version' => [
                    'min_amount' => 0, 'max_amount' => 49999.99, 'valid_days' => 90,
                    'rate1' => 1.00, 'rate2' => 2.00, 'rate3' => 2.50,
                    'service_charge' => 60, 'service_charge_below_threshold' => 30,
                    'postage_charge' => 150,
                    'letter_1_days' => 14, 'letter_2_days' => 14, 'letter_3_days' => 14, 'forfeit_reminder_days' => 14,
                ],
            ],
            [
                'scheme' => ['code' => 'B', 'name' => 'Type B (Rs. 50,000 - 99,999)', 'metal' => 'gold', 'interest_method' => 'tiered'],
                'version' => [
                    'min_amount' => 50000, 'max_amount' => 99999.99, 'valid_days' => 182,
                    'rate1' => 1.00, 'rate2' => 1.50, 'rate3' => 1.98,
                    'service_charge' => 30, 'service_charge_below_threshold' => 15,
                    'postage_charge' => 150,
                    'letter_1_days' => 21, 'letter_2_days' => 14, 'letter_3_days' => 14, 'forfeit_reminder_days' => 14,
                ],
            ],
            [
                'scheme' => ['code' => 'C', 'name' => 'Type C (Rs. 100,000 and above)', 'metal' => 'gold', 'interest_method' => 'tiered'],
                'version' => [
                    'min_amount' => 100000, 'max_amount' => null, 'valid_days' => 30,
                    'rate1' => 1.00, 'rate2' => 1.50, 'rate3' => 1.89,
                    'service_charge' => 30, 'service_charge_below_threshold' => 15,
                    'postage_charge' => 150,
                    'letter_1_days' => 21, 'letter_2_days' => 21, 'letter_3_days' => 21, 'forfeit_reminder_days' => 21,
                ],
            ],
            [
                'scheme' => ['code' => 'SILVER', 'name' => 'Silver', 'metal' => 'silver', 'interest_method' => 'silver'],
                'version' => [
                    // Old validPeriod was 0; SilverInterest falls back to a 30-day period.
                    'min_amount' => 0, 'max_amount' => null, 'valid_days' => 30,
                    'rate1' => 6.00, 'rate2' => 6.00, 'rate3' => 6.00,
                    'service_charge' => 0, 'service_charge_below_threshold' => 30,
                    'postage_charge' => 150,
                    'letter_1_days' => 14, 'letter_2_days' => 14, 'letter_3_days' => 14, 'forfeit_reminder_days' => 14,
                ],
            ],
        ];

        foreach ($schemes as $s) {
            DB::table('pawn_schemes')->updateOrInsert(['code' => $s['scheme']['code']], $s['scheme'] + [
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $schemeId = DB::table('pawn_schemes')->where('code', $s['scheme']['code'])->value('id');

            if (! DB::table('pawn_scheme_versions')->where('scheme_id', $schemeId)->exists()) {
                DB::table('pawn_scheme_versions')->insert($s['version'] + [
                    'scheme_id' => $schemeId,
                    'effective_from' => '2026-01-01',
                    'effective_to' => null,
                    'max_term_months' => 12,
                    'period1_days' => 10,
                    'period2_days' => 15,
                    'period3_days' => 30,
                    'penalty_rate_monthly' => 0,
                    'service_charge_above_percent' => 0,
                    'service_charge_threshold' => 25000,
                    'document_charge' => 0,
                    'stamp_duty' => 0,
                    'min_capital_after_part_payment' => 1000,
                    'created_at' => $now,
                ]);
            }
        }
    }
}
