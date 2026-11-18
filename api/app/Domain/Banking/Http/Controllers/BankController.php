<?php

namespace App\Domain\Banking\Http\Controllers;

use App\Domain\Banking\Models\Bank;
use App\Domain\Banking\Models\BankBranch;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/** Bank and bank-branch master (used for cheques and company bank accounts). */
class BankController extends Controller
{
    public function index(): JsonResource
    {
        return JsonResource::collection(Bank::with('branches')->orderBy('name')->get());
    }

    public function store(Request $request): JsonResource
    {
        $this->authorize('masters.manage');

        return new JsonResource(Bank::create($request->validate([
            'code' => ['required', 'string', 'max:10', 'unique:banks,code'],
            'name' => ['required', 'string', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ]))->load('branches'));
    }

    public function update(Request $request, Bank $bank): JsonResource
    {
        $this->authorize('masters.manage');
        $bank->update($request->validate([
            'code' => ['sometimes', 'string', 'max:10', Rule::unique('banks', 'code')->ignore($bank->id)],
            'name' => ['sometimes', 'string', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ]));

        return new JsonResource($bank->load('branches'));
    }

    public function storeBranch(Request $request, Bank $bank): JsonResource
    {
        $this->authorize('masters.manage');
        $data = $request->validate([
            'code' => ['required', 'string', 'max:10', Rule::unique('bank_branches', 'code')->where('bank_id', $bank->id)],
            'name' => ['required', 'string', 'max:100'],
        ]);

        return new JsonResource($bank->branches()->create($data));
    }

    public function updateBranch(Request $request, Bank $bank, BankBranch $branch): JsonResource
    {
        $this->authorize('masters.manage');
        abort_unless($branch->bank_id === $bank->id, 404);
        $branch->update($request->validate([
            'code' => ['sometimes', 'string', 'max:10',
                Rule::unique('bank_branches', 'code')->where('bank_id', $bank->id)->ignore($branch->id)],
            'name' => ['sometimes', 'string', 'max:100'],
        ]));

        return new JsonResource($branch);
    }
}
