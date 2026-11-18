<?php

namespace App\Domain\Customers\Http\Controllers;

use App\Domain\Core\Services\SequenceService;
use App\Domain\Core\Support\BranchContext;
use App\Domain\Customers\Http\Requests\CustomerRequest;
use App\Domain\Customers\Http\Resources\CustomerResource;
use App\Domain\Customers\Models\Customer;
use App\Domain\Customers\Services\CustomerExposure;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class CustomerController extends Controller
{
    public function __construct(
        private CustomerExposure $exposure,
        private SequenceService $sequences,
        private BranchContext $branch,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        $this->authorize('customers.view');
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(Customer::STATUSES)],
            'branch_id' => ['nullable', 'integer'],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:100'],
        ]);

        $customers = Customer::query()
            ->with('branch:id,code,name')
            ->search($filters['q'] ?? null)
            ->when($filters['status'] ?? null, fn ($q, $s) => $q->where('status', $s))
            ->when($filters['branch_id'] ?? null, fn ($q, $b) => $q->where('branch_id', $b))
            ->orderByDesc('id')
            ->paginate($filters['per_page'] ?? 25)
            ->withQueryString();

        return CustomerResource::collection($customers);
    }

    public function show(Customer $customer): CustomerResource
    {
        $this->authorize('customers.view');

        return (new CustomerResource($customer->load('branch:id,code,name')))
            ->withExposure($this->exposure->for($customer));
    }

    /** Exact NIC lookup used by the pawn counter. */
    public function byNic(string $nic): CustomerResource
    {
        $this->authorize('customers.view');
        $customer = Customer::where('nic', strtoupper(str_replace(' ', '', $nic)))->firstOrFail();

        return (new CustomerResource($customer->load('branch:id,code,name')))
            ->withExposure($this->exposure->for($customer));
    }

    public function store(CustomerRequest $request): JsonResponse
    {
        $customer = DB::transaction(fn () => Customer::create($request->validated() + [
            'branch_id' => $this->branch->requireId(),
            'code' => $this->sequences->next('customer'),
            'status' => Customer::STATUS_ACTIVE,
            'created_by' => auth()->id(),
            'updated_by' => auth()->id(),
        ]));

        return (new CustomerResource($customer->fresh('branch')))
            ->withExposure($this->exposure->for($customer))
            ->response()->setStatusCode(201);
    }

    public function update(CustomerRequest $request, Customer $customer): CustomerResource
    {
        $customer->update($request->validated() + ['updated_by' => auth()->id()]);

        return (new CustomerResource($customer->fresh('branch')))
            ->withExposure($this->exposure->for($customer));
    }

    public function updateStatus(Request $request, Customer $customer): CustomerResource
    {
        $this->authorize('customers.manage');
        $data = $request->validate([
            'status' => ['required', Rule::in(Customer::STATUSES)],
            'reason' => ['required', 'string', 'max:500'],
        ]);

        DB::transaction(function () use ($customer, $data) {
            $old = $customer->status;
            $customer->forceFill(['status' => $data['status'], 'updated_by' => auth()->id()])->saveQuietly();
            $customer->writeAudit('status_changed', ['status' => $old], ['status' => $data['status'], 'reason' => $data['reason']]);
        });

        return (new CustomerResource($customer->fresh('branch')))
            ->withExposure($this->exposure->for($customer));
    }

    public function updateLimits(Request $request, Customer $customer): CustomerResource
    {
        $this->authorize('customers.set_limits');
        $data = $request->validate([
            'pawn_amount_limit' => ['nullable', 'numeric', 'min:0', 'max:9999999999.99'],
            'pawn_count_limit' => ['nullable', 'integer', 'min:0', 'max:1000'],
        ]);

        $amount = isset($data['pawn_amount_limit']) ? (string) $data['pawn_amount_limit'] : null;
        $count = $data['pawn_count_limit'] ?? null;

        DB::transaction(function () use ($customer, $amount, $count) {
            $locked = Customer::lockForUpdate()->findOrFail($customer->id);
            $this->exposure->assertLimitsCoverExposure($locked, $amount, $count);
            $locked->update(['pawn_amount_limit' => $amount, 'pawn_count_limit' => $count, 'updated_by' => auth()->id()]);
        });

        return (new CustomerResource($customer->fresh('branch')))
            ->withExposure($this->exposure->for($customer));
    }
}
