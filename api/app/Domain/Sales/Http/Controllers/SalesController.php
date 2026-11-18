<?php

namespace App\Domain\Sales\Http\Controllers;

use App\Domain\Core\Models\Company;
use App\Domain\Inventory\Models\InventoryItem;
use App\Domain\Sales\Models\SalesInvoice;
use App\Domain\Sales\Services\SalesService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/** Sale stock (forfeited articles) and sales invoices. */
class SalesController extends Controller
{
    public function __construct(private SalesService $sales) {}

    // ---------------------------------------------------------------- stock

    public function inventory(Request $request): JsonResponse
    {
        $this->authorize('inventory.view');
        $f = $request->validate([
            'q' => ['nullable', 'string', 'max:60'],
            'status' => ['nullable', Rule::in(['in_stock', 'sold'])],
            'category_id' => ['nullable', 'integer'],
        ]);
        $q = trim((string) ($f['q'] ?? ''));

        $base = InventoryItem::query()
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->where('item_code', 'like', "%{$q}%")
                ->orWhere('barcode', $q)->orWhere('description', 'like', "%{$q}%")))
            ->when($f['status'] ?? 'in_stock', fn ($w, $s) => $w->where('status', $s))
            ->when($f['category_id'] ?? null, fn ($w, $c) => $w->where('category_id', $c));

        $totals = (clone $base)->selectRaw('COUNT(*) AS items, COALESCE(SUM(cost_price),0) AS cost, COALESCE(SUM(sale_price),0) AS sale, COALESCE(SUM(net_weight),0) AS weight')->first();
        $items = $base->with(['category:id,name', 'karat:id,name', 'articleType:id,name', 'forfeiture.ticket:id,receipt_no'])
            ->orderByDesc('id')->paginate(50)->withQueryString();

        return response()->json([
            'data' => collect($items->items())->map(fn ($i) => $this->presentItem($i)),
            'meta' => [
                'current_page' => $items->currentPage(), 'last_page' => $items->lastPage(), 'total' => $items->total(),
                'from' => $items->firstItem(), 'to' => $items->lastItem(),
                'totals' => ['items' => (int) $totals->items, 'cost' => $totals->cost, 'sale' => $totals->sale, 'weight' => $totals->weight],
            ],
        ]);
    }

    /** Exact item-code / barcode lookup for the sales screen (in-stock only). */
    public function lookup(string $code): JsonResponse
    {
        $this->authorize('sales.create');
        $item = InventoryItem::with(['category:id,name', 'karat:id,name', 'articleType:id,name', 'forfeiture.ticket:id,receipt_no'])
            ->where(fn ($q) => $q->where('item_code', $code)->orWhere('barcode', $code))->first();

        abort_if(! $item, 404, 'No item with this code in this branch.');

        return response()->json(['data' => $this->presentItem($item)]);
    }

    public function updatePrice(Request $request, InventoryItem $item): JsonResponse
    {
        $this->authorize('sales.void');   // branch-manager level
        $price = $request->validate(['sale_price' => ['required', 'numeric', 'gt:0', 'max:99999999']])['sale_price'];
        abort_if($item->status !== InventoryItem::IN_STOCK, 422, 'Only items in stock can be re-priced.');
        $item->update(['sale_price' => $price]);

        return response()->json(['data' => $this->presentItem($item->fresh(['category', 'karat', 'articleType']))]);
    }

    // ---------------------------------------------------------------- invoices

    public function index(Request $request): JsonResource
    {
        $this->authorize('sales.create');
        $f = $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date'], 'q' => ['nullable', 'string', 'max:60']]);

        return JsonResource::collection(SalesInvoice::query()->withCount('lines')->with('creator:id,name')
            ->when($f['from'] ?? null, fn ($q, $d) => $q->where('invoice_date', '>=', $d))
            ->when($f['to'] ?? null, fn ($q, $d) => $q->where('invoice_date', '<', now()->parse($d)->addDay()))
            ->when($f['q'] ?? null, fn ($q, $s) => $q->where(fn ($w) => $w->where('invoice_no', $s)->orWhere('customer_name', 'like', "%{$s}%")))
            ->orderByDesc('id')->paginate(25)->withQueryString());
    }

    public function show(SalesInvoice $invoice): JsonResponse
    {
        $this->authorize('sales.create');
        $invoice->load(['lines.item.category', 'lines.item.karat', 'lines.item.articleType', 'creator:id,name', 'voider:id,name', 'branch']);

        return response()->json(['data' => [
            'invoice' => $invoice,
            'company' => Company::current(),
        ]]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorize('sales.create');
        $data = $request->validate([
            'lines' => ['required', 'array', 'min:1', 'max:50'],
            'lines.*.inventory_item_id' => ['required', 'integer'],
            'lines.*.unit_price' => ['required', 'numeric', 'gt:0'],
            'lines.*.discount' => ['nullable', 'numeric', 'min:0'],
            'customer_id' => ['nullable', 'integer', 'exists:customers,id'],
            'customer_name' => ['nullable', 'string', 'max:150'],
            'customer_phone' => ['nullable', 'string', 'max:20'],
            'paid_cash' => ['nullable', 'numeric', 'min:0'],
            'paid_card' => ['nullable', 'numeric', 'min:0'],
        ]);

        return response()->json(['data' => $this->sales->create($data)], 201);
    }

    public function void(Request $request, SalesInvoice $invoice): JsonResponse
    {
        $this->authorize('sales.void');
        $reason = $request->validate(['reason' => ['required', 'string', 'max:500']])['reason'];

        return response()->json(['data' => $this->sales->void($invoice, $reason)]);
    }

    private function presentItem(InventoryItem $i): array
    {
        return [
            'id' => $i->id, 'item_code' => $i->item_code, 'barcode' => $i->barcode, 'status' => $i->status,
            'category' => $i->category?->name, 'article_type' => $i->articleType?->name, 'karat' => $i->karat?->name,
            'description' => $i->description, 'quantity' => $i->quantity,
            'gross_weight' => $i->gross_weight, 'net_weight' => $i->net_weight,
            'cost_price' => $i->cost_price, 'sale_price' => $i->sale_price,
            'received_at' => $i->received_at?->toIso8601String(), 'sold_at' => $i->sold_at?->toIso8601String(),
            'receipt_no' => $i->forfeiture?->ticket?->receipt_no,
        ];
    }
}
