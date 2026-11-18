<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Karat grades + rates, article categories / types / conditions.
 * Source: JSON exported from the old system (database/seeders/data).
 */
class MasterDataSeeder extends Seeder
{
    /** Old item_setups used different spellings for some categories. */
    private const CATEGORY_ALIASES = [
        'pottoo' => 'Potto',
        'thli' => 'Thli',
    ];

    public function run(): void
    {
        $now = now();

        // --- Karat grades and their opening rates -----------------------------
        foreach ($this->json('karats') as $i => $k) {
            $isSilver = Str::startsWith(Str::lower($k['name']), 'silw') || Str::contains(Str::lower($k['name']), 'silver');
            $code = $isSilver ? 'SILVER' : trim(Str::before($k['name'], ' - '));
            $name = $isSilver ? 'Silver' : $k['name'];

            // Old A2 assess rate was entered as 2,900,000 (10x the neighbouring grades).
            $assess = $k['assess_rate'] >= 1_000_000 ? $k['assess_rate'] / 10 : $k['assess_rate'];

            DB::table('karats')->updateOrInsert(['code' => $code], [
                'name' => $name,
                'metal' => $isSilver ? 'silver' : 'gold',
                'purity_karat' => $isSilver ? null : 22,
                'sort_order' => $i + 1,
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $karatId = DB::table('karats')->where('code', $code)->value('id');
            if (! DB::table('karat_rates')->where('karat_id', $karatId)->exists()) {
                DB::table('karat_rates')->insert([
                    'karat_id' => $karatId,
                    'effective_from' => '2026-01-01 00:00:00',
                    'pawn_rate_per_8g' => $k['pawn_rate'],
                    'assess_rate_per_8g' => $assess,
                    'market_rate_per_8g' => $k['market_rate'],
                    'sale_rate_per_8g' => $k['sale_rate'],
                    'created_at' => $now,
                ]);
            }
        }

        // --- Categories ---------------------------------------------------------
        foreach ($this->json('article_categories') as $name) {
            $this->upsertCategory($name);
        }

        // --- Article types (old item_setups) --------------------------------------
        $categories = DB::table('article_categories')->pluck('id', 'name')
            ->mapWithKeys(fn ($id, $name) => [Str::lower($name) => $id]);

        foreach ($this->json('article_types') as $t) {
            $key = Str::lower($t['category']);
            $key = Str::lower(self::CATEGORY_ALIASES[$key] ?? $t['category']);

            if (! isset($categories[$key])) {
                $categories[$key] = $this->upsertCategory(Str::title(Str::lower($t['category'])));
            }

            DB::table('article_types')->updateOrInsert(['code' => $t['code']], [
                'category_id' => $categories[$key],
                'name' => $t['name'],
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // --- Conditions -----------------------------------------------------------
        foreach ($this->json('article_conditions') as $name) {
            DB::table('article_conditions')->updateOrInsert(['name' => $name], [
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    private function upsertCategory(string $name): int
    {
        DB::table('article_categories')->updateOrInsert(['name' => $name], [
            'metal' => Str::contains(Str::lower($name), 'silver') ? 'silver' : 'gold',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) DB::table('article_categories')->where('name', $name)->value('id');
    }

    private function json(string $file): array
    {
        return json_decode(file_get_contents(__DIR__."/data/{$file}.json"), true, flags: JSON_THROW_ON_ERROR);
    }
}
