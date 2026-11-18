<?php

namespace App\Domain\Masters\Http\Controllers;

use App\Domain\Masters\Models\ArticleCategory;
use App\Domain\Masters\Models\ArticleCondition;
use App\Domain\Masters\Models\ArticleType;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/**
 * Article categories, types and conditions. Records are never deleted
 * (tickets reference them) — set is_active = false instead.
 */
class ArticleMasterController extends Controller
{
    // ---- Categories ----------------------------------------------------------

    public function categories(): JsonResource
    {
        return JsonResource::collection(ArticleCategory::withCount('types')->orderBy('name')->get());
    }

    public function storeCategory(Request $request): JsonResource
    {
        $this->authorize('masters.manage');

        return new JsonResource(ArticleCategory::create($this->categoryRules($request)));
    }

    public function updateCategory(Request $request, ArticleCategory $category): JsonResource
    {
        $this->authorize('masters.manage');
        $category->update($this->categoryRules($request, $category));

        return new JsonResource($category);
    }

    private function categoryRules(Request $request, ?ArticleCategory $c = null): array
    {
        $req = $c ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$req, 'string', 'max:60', Rule::unique('article_categories', 'name')->ignore($c?->id)],
            'metal' => [$req, Rule::in(['gold', 'silver', 'other'])],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    // ---- Types ---------------------------------------------------------------

    public function types(Request $request): JsonResource
    {
        $query = ArticleType::with('category:id,name')->orderBy('code');
        if ($request->filled('category_id')) {
            $query->where('category_id', $request->integer('category_id'));
        }

        return JsonResource::collection($query->get());
    }

    public function storeType(Request $request): JsonResource
    {
        $this->authorize('masters.manage');
        $data = $this->typeRules($request);
        $data['code'] ??= $this->nextTypeCode();

        return new JsonResource(ArticleType::create($data)->load('category:id,name'));
    }

    public function updateType(Request $request, ArticleType $type): JsonResource
    {
        $this->authorize('masters.manage');
        $type->update($this->typeRules($request, $type));

        return new JsonResource($type->load('category:id,name'));
    }

    private function typeRules(Request $request, ?ArticleType $t = null): array
    {
        $req = $t ? 'sometimes' : 'required';
        $categoryId = $request->input('category_id', $t?->category_id);

        return $request->validate([
            'category_id' => [$req, 'integer', 'exists:article_categories,id'],
            'code' => ['sometimes', 'nullable', 'string', 'max:20', Rule::unique('article_types', 'code')->ignore($t?->id)],
            'name' => [$req, 'string', 'max:100',
                Rule::unique('article_types', 'name')->where('category_id', $categoryId)->ignore($t?->id)],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    private function nextTypeCode(): string
    {
        $last = ArticleType::where('code', 'like', 'ITM-%')->orderByDesc('code')->value('code');
        $n = $last ? ((int) substr($last, 4)) + 1 : 1;

        return 'ITM-'.str_pad((string) $n, 4, '0', STR_PAD_LEFT);
    }

    // ---- Conditions ------------------------------------------------------------

    public function conditions(): JsonResource
    {
        return JsonResource::collection(ArticleCondition::orderBy('name')->get());
    }

    public function storeCondition(Request $request): JsonResource
    {
        $this->authorize('masters.manage');

        return new JsonResource(ArticleCondition::create($request->validate([
            'name' => ['required', 'string', 'max:60', 'unique:article_conditions,name'],
            'is_active' => ['sometimes', 'boolean'],
        ])));
    }

    public function updateCondition(Request $request, ArticleCondition $condition): JsonResource
    {
        $this->authorize('masters.manage');
        $condition->update($request->validate([
            'name' => ['sometimes', 'string', 'max:60', Rule::unique('article_conditions', 'name')->ignore($condition->id)],
            'is_active' => ['sometimes', 'boolean'],
        ]));

        return new JsonResource($condition);
    }
}
