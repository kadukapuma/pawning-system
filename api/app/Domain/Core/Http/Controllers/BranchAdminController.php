<?php

namespace App\Domain\Core\Http\Controllers;

use App\Domain\Core\Models\Branch;
use App\Domain\Core\Models\Company;
use App\Domain\Core\Models\DocumentSequence;
use App\Http\Controllers\Controller;
use Database\Seeders\DocumentSequenceSeeder;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Branches and the company profile. */
class BranchAdminController extends Controller
{
    public function index(): JsonResource
    {
        $this->authorize('branches.manage');

        return JsonResource::collection(Branch::withCount('users')->orderBy('code')->get());
    }

    public function store(Request $request): JsonResource
    {
        $this->authorize('branches.manage');
        $data = $this->validated($request);

        $branch = DB::transaction(function () use ($data) {
            $branch = Branch::create($data + ['is_active' => true]);

            // A new branch needs its own document counters.
            foreach (DocumentSequenceSeeder::TYPES as $type => [$prefix, $padding]) {
                DocumentSequence::create([
                    'branch_id' => $branch->id,
                    'doc_type' => $type,
                    'prefix' => $type === 'customer' ? $prefix.$branch->code : $prefix,
                    'next_number' => 1,
                    'padding' => $padding,
                ]);
            }

            return $branch;
        });

        return new JsonResource($branch);
    }

    public function update(Request $request, Branch $branch): JsonResource
    {
        $this->authorize('branches.manage');
        $branch->update($this->validated($request, $branch));

        return new JsonResource($branch);
    }

    public function company(): JsonResource
    {
        return new JsonResource(Company::current());
    }

    public function updateCompany(Request $request): JsonResource
    {
        $this->authorize('branches.manage');
        $company = Company::current();
        $company->update($request->validate([
            'name' => ['required', 'string', 'max:150'],
            'registration_no' => ['nullable', 'string', 'max:50'],
            'address' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:20'],
            'phone2' => ['nullable', 'string', 'max:20'],
            'email' => ['nullable', 'email', 'max:150'],
            'receipt_footer' => ['nullable', 'string', 'max:500'],
        ]));

        return new JsonResource($company);
    }

    private function validated(Request $request, ?Branch $branch = null): array
    {
        return $request->validate([
            // Code is permanent: it is printed on documents and part of customer codes.
            'code' => $branch ? ['prohibited'] : ['required', 'digits:3', 'unique:branches,code'],
            'name' => ['required', 'string', 'max:100', Rule::unique('branches', 'name')->ignore($branch?->id)],
            'address' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:20'],
            'phone2' => ['nullable', 'string', 'max:20'],
            'opened_on' => ['nullable', 'date'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }
}
