<?php

namespace App\Domain\Masters\Http\Controllers;

use App\Domain\Masters\Models\Karat;
use App\Domain\Masters\Models\KaratRate;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Karat rate grades and their per-8 g rates (pawn / assess / market / sale). */
class KaratController extends Controller
{
    public function index(): JsonResource
    {
        return JsonResource::collection(Karat::with('currentRate.creator:id,name')->ordered()->get());
    }

    public function store(Request $request): JsonResource
    {
        $this->authorize('karat_rates.manage');
        $data = $this->validated($request);
        $rates = $request->validate($this->rateRules());

        $karat = DB::transaction(function () use ($data, $rates) {
            $karat = Karat::create($data);
            $this->addRate($karat, $rates, now());

            return $karat;
        });

        return new JsonResource($karat->load('currentRate'));
    }

    public function update(Request $request, Karat $karat): JsonResource
    {
        $this->authorize('karat_rates.manage');
        $karat->update($this->validated($request, $karat));

        return new JsonResource($karat->load('currentRate'));
    }

    public function history(Karat $karat): JsonResource
    {
        return JsonResource::collection($karat->rates()->with('creator:id,name')->limit(100)->get());
    }

    /**
     * Update today's rates for several grades at once. Rows whose values did
     * not change are skipped, so the history only shows real changes.
     */
    public function updateRates(Request $request): JsonResource
    {
        $this->authorize('karat_rates.manage');
        $data = $request->validate([
            'rates' => ['required', 'array', 'min:1'],
            'rates.*.karat_id' => ['required', 'integer', 'distinct', 'exists:karats,id'],
            ...collect($this->rateRules())->mapWithKeys(fn ($r, $k) => ["rates.*.{$k}" => $r])->all(),
        ]);

        $changed = DB::transaction(function () use ($data) {
            $now = now();
            $changed = 0;
            foreach ($data['rates'] as $row) {
                $karat = Karat::with('currentRate')->findOrFail($row['karat_id']);
                $current = $karat->currentRate;
                $same = $current
                    && (float) $current->pawn_rate_per_8g === (float) $row['pawn_rate_per_8g']
                    && (float) $current->assess_rate_per_8g === (float) $row['assess_rate_per_8g']
                    && (float) $current->market_rate_per_8g === (float) $row['market_rate_per_8g']
                    && (float) $current->sale_rate_per_8g === (float) $row['sale_rate_per_8g'];
                if (! $same) {
                    $this->addRate($karat, $row, $now);
                    $changed++;
                }
            }

            return $changed;
        });

        return JsonResource::collection(Karat::with('currentRate')->ordered()->get())
            ->additional(['meta' => ['changed' => $changed]]);
    }

    private function addRate(Karat $karat, array $rates, $at): KaratRate
    {
        return KaratRate::create([
            'karat_id' => $karat->id,
            'effective_from' => $at,
            'pawn_rate_per_8g' => $rates['pawn_rate_per_8g'],
            'assess_rate_per_8g' => $rates['assess_rate_per_8g'],
            'market_rate_per_8g' => $rates['market_rate_per_8g'],
            'sale_rate_per_8g' => $rates['sale_rate_per_8g'],
            'created_by' => auth()->id(),
        ]);
    }

    private function rateRules(): array
    {
        $r = ['required', 'numeric', 'gt:0', 'max:99999999.99'];

        return [
            'pawn_rate_per_8g' => $r,
            'assess_rate_per_8g' => $r,
            'market_rate_per_8g' => $r,
            'sale_rate_per_8g' => $r,
        ];
    }

    private function validated(Request $request, ?Karat $karat = null): array
    {
        $required = $karat ? 'sometimes' : 'required';

        return $request->validate([
            'code' => [$required, 'string', 'max:20', Rule::unique('karats', 'code')->ignore($karat?->id)],
            'name' => [$required, 'string', 'max:60'],
            'metal' => [$required, Rule::in(['gold', 'silver'])],
            'purity_karat' => ['nullable', 'numeric', 'min:1', 'max:24'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:65535'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }
}
