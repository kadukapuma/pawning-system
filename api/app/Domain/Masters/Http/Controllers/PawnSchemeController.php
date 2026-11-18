<?php

namespace App\Domain\Masters\Http\Controllers;

use App\Domain\Masters\Http\Requests\SchemeTermsRequest;
use App\Domain\Masters\Models\PawnScheme;
use App\Domain\Masters\Services\SchemeVersionService;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class PawnSchemeController extends Controller
{
    public function __construct(private SchemeVersionService $versions) {}

    public function index(): JsonResource
    {
        return JsonResource::collection(
            PawnScheme::with('currentVersion')->orderBy('code')->get()
        );
    }

    public function show(PawnScheme $scheme): JsonResource
    {
        return new JsonResource($scheme->load(['currentVersion', 'versions.creator:id,name']));
    }

    /** New scheme with its first version. */
    public function store(Request $request): JsonResource
    {
        $this->authorize('schemes.manage');
        $data = $request->validate([
            'code' => ['required', 'string', 'max:20', 'alpha_dash', 'unique:pawn_schemes,code'],
            'name' => ['required', 'string', 'max:60'],
            'metal' => ['required', Rule::in(['gold', 'silver'])],
            'interest_method' => ['required', Rule::in(PawnScheme::METHODS)],
        ] + SchemeTermsRequest::termRules());

        $scheme = DB::transaction(function () use ($data) {
            $scheme = PawnScheme::create([
                'code' => strtoupper($data['code']),
                'name' => $data['name'],
                'metal' => $data['metal'],
                'interest_method' => $data['interest_method'],
                'is_active' => true,
            ]);
            $this->versions->createVersion($scheme, $data, $data['effective_from'] ?? null);

            return $scheme;
        });

        return new JsonResource($scheme->load('currentVersion'));
    }

    /** Name / active flag only. Code and method are fixed once tickets may reference the scheme. */
    public function update(Request $request, PawnScheme $scheme): JsonResource
    {
        $this->authorize('schemes.manage');
        $scheme->update($request->validate([
            'name' => ['sometimes', 'string', 'max:60'],
            'is_active' => ['sometimes', 'boolean'],
        ]));

        return new JsonResource($scheme->load('currentVersion'));
    }

    /** Change terms: closes the current version and adds a new one. */
    public function storeVersion(SchemeTermsRequest $request, PawnScheme $scheme): JsonResource
    {
        $version = $this->versions->createVersion($scheme, $request->validated(), $request->input('effective_from'));

        return new JsonResource($version);
    }
}
