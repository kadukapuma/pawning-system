<?php

namespace App\Domain\Pawning\Services;

use App\Domain\Core\Support\Money;
use App\Domain\Masters\Models\ArticleCategory;
use App\Domain\Masters\Models\Karat;
use App\Domain\Pawning\Calculation\Valuation;
use Illuminate\Validation\ValidationException;

/**
 * Values articles at today's karat rates (pawn rate for the loan value,
 * market rate for reference). Rates are per 8 g.
 */
class ItemValuer
{
    /**
     * @param  list<array{category_id:int, karat_id:int, net_weight:string|float, gross_weight:string|float, quantity?:int, article_type_id?:?int, condition_id?:?int, description?:?string}>  $items
     * @return array{items: list<array>, assessed_value: string, market_value: string, gross_weight: string, net_weight: string, is_silver: bool}
     */
    public function value(array $items): array
    {
        $karats = Karat::with('currentRate')->whereIn('id', array_column($items, 'karat_id'))->get()->keyBy('id');
        $categories = ArticleCategory::whereIn('id', array_column($items, 'category_id'))->get()->keyBy('id');

        $out = [];
        $value = $market = $gross = $net = '0';
        $silver = false;

        foreach ($items as $i => $item) {
            $karat = $karats[$item['karat_id']] ?? null;
            $category = $categories[$item['category_id']] ?? null;
            if (! $karat || ! $karat->is_active || ! $karat->currentRate) {
                throw ValidationException::withMessages(["items.{$i}.karat_id" => 'This karat grade has no current rate.']);
            }
            if (! $category || ! $category->is_active) {
                throw ValidationException::withMessages(["items.{$i}.category_id" => 'Choose an active category.']);
            }
            if ((float) $item['net_weight'] > (float) $item['gross_weight']) {
                throw ValidationException::withMessages(["items.{$i}.net_weight" => 'Net weight cannot be more than gross weight.']);
            }

            $rate = (string) $karat->currentRate->pawn_rate_per_8g;
            $itemValue = Valuation::articleValue($rate, $item['net_weight']);
            $itemMarket = Valuation::articleValue((string) $karat->currentRate->market_rate_per_8g, $item['net_weight']);
            $silver = $silver || $karat->metal === 'silver' || $category->metal === 'silver';

            $out[] = [
                'category_id' => (int) $item['category_id'],
                'article_type_id' => $item['article_type_id'] ?? null,
                'condition_id' => $item['condition_id'] ?? null,
                'karat_id' => (int) $item['karat_id'],
                'description' => $item['description'] ?? null,
                'quantity' => (int) ($item['quantity'] ?? 1),
                'gross_weight' => number_format((float) $item['gross_weight'], 3, '.', ''),
                'net_weight' => number_format((float) $item['net_weight'], 3, '.', ''),
                'karat_rate_per_8g' => Money::of($rate),
                'assessed_value' => $itemValue,
                'market_value' => $itemMarket,
            ];

            $value = Money::add($value, $itemValue);
            $market = Money::add($market, $itemMarket);
            $gross = bcadd($gross, (string) $item['gross_weight'], 3);
            $net = bcadd($net, (string) $item['net_weight'], 3);
        }

        return [
            'items' => $out,
            'assessed_value' => Money::of($value),
            'market_value' => Money::of($market),
            'gross_weight' => $gross,
            'net_weight' => $net,
            'is_silver' => $silver,
        ];
    }
}
