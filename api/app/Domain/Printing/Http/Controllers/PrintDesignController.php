<?php

namespace App\Domain\Printing\Http\Controllers;

use App\Domain\Core\Models\Company;
use App\Domain\Core\Support\BranchContext;
use App\Domain\Printing\Models\PrintDesign;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Print Designer: an administrator places every block of a printed document on the page.
 * Print pages only read the active design; managing designs needs print_designs.manage.
 */
class PrintDesignController extends Controller
{
    /**
     * The design to print with (null template when the standard layout applies), plus the
     * company and working-branch details every design may place on the page.
     */
    public function active(string $document, BranchContext $context): JsonResource
    {
        $this->assertDocument($document);

        $design = PrintDesign::query()->where('document_key', $document)->where('active', true)->first();
        $company = Company::current();
        $branch = $context->branch();

        return new JsonResource([
            'template' => $design?->template,
            'company' => [
                'name' => $company->name,
                'address' => $company->address,
                'phone' => $company->phone,
                'email' => $company->email,
                'receipt_footer' => $company->receipt_footer,
                'logo' => $company->logo_path ? Storage::disk('public')->url($company->logo_path) : null,
            ],
            'branch' => $branch ? [
                'name' => $branch->name,
                'address' => $branch->address ?? null,
                'phone' => $branch->phone ?? null,
            ] : null,
        ]);
    }

    public function index(): JsonResource
    {
        $this->authorize('print_designs.manage');

        return new JsonResource(
            PrintDesign::query()->with('editor:id,name')->get()->map->summary()->values()
        );
    }

    public function show(string $document): JsonResource
    {
        $this->authorize('print_designs.manage');
        $this->assertDocument($document);

        $design = PrintDesign::query()->where('document_key', $document)->first();

        return new JsonResource([
            'template' => $design?->template,
            'active' => (bool) $design?->active,
            'updated_by' => $design?->editor?->name,
            'updated_at' => $design?->updated_at,
        ]);
    }

    public function update(Request $request, string $document): JsonResource
    {
        $this->authorize('print_designs.manage');
        $this->assertDocument($document);
        $validated = $request->validate($this->rules());

        $design = PrintDesign::query()->updateOrCreate(
            ['document_key' => $document],
            [
                'template' => $validated['template'],
                'active' => $validated['active'],
                'updated_by' => $request->user()->id,
            ]
        );

        return (new JsonResource($design->load('editor:id,name')->summary()))->additional([
            'message' => $design->active
                ? 'Design saved. This document now prints with your design.'
                : 'Design saved as a draft. The standard layout still prints.',
        ]);
    }

    /** Remove the design: the document returns to its standard layout. */
    public function destroy(string $document): JsonResource
    {
        $this->authorize('print_designs.manage');
        $this->assertDocument($document);
        PrintDesign::query()->where('document_key', $document)->first()?->delete();

        return new JsonResource(['message' => 'Design removed. This document prints with the standard layout.']);
    }

    private function assertDocument(string $document): void
    {
        abort_unless(in_array($document, PrintDesign::DOCUMENTS, true), 404);
    }

    /** Only the keys listed here are stored; anything else is dropped. */
    private function rules(): array
    {
        $position = ['required', 'numeric', 'min:-50', 'max:2000'];
        $size = ['required', 'numeric', 'min:0', 'max:2000'];
        $flag = ['nullable', 'boolean'];
        $align = ['nullable', Rule::in(['left', 'center', 'right'])];
        $el = 'template.elements.*';
        $table = "{$el}.table";

        return [
            'active' => ['required', 'boolean'],
            'template' => ['required', 'array'],
            'template.version' => ['required', 'integer', Rule::in([1])],
            'template.paper' => ['required', 'array'],
            'template.paper.width_mm' => ['required', 'numeric', 'min:30', 'max:1000'],
            // 0 = continuous roll
            'template.paper.height_mm' => ['required', 'numeric', 'min:0', 'max:2000'],
            'template.paper.margin_x_mm' => ['nullable', 'numeric', 'min:0', 'max:200'],
            'template.paper.margin_y_mm' => ['nullable', 'numeric', 'min:0', 'max:200'],
            'template.paper.margin_top_mm' => ['nullable', 'numeric', 'min:0', 'max:200'],
            'template.paper.margin_bottom_mm' => ['nullable', 'numeric', 'min:0', 'max:200'],
            'template.paper.margin_left_mm' => ['nullable', 'numeric', 'min:0', 'max:200'],
            'template.paper.margin_right_mm' => ['nullable', 'numeric', 'min:0', 'max:200'],
            'template.font' => ['required', 'array'],
            'template.font.family' => ['required', 'string', 'max:100', 'regex:/^[A-Za-z0-9 ,\'\-]+$/'],
            'template.font.size' => ['required', 'numeric', 'min:4', 'max:40'],
            'template.elements' => ['required', 'array', 'max:200'],
            "{$el}.id" => ['required', 'string', 'max:60'],
            "{$el}.type" => ['required', Rule::in(['text', 'logo', 'line', 'box', 'table'])],
            "{$el}.x" => $position,
            "{$el}.y" => $position,
            "{$el}.w" => $size,
            "{$el}.h" => $size,
            "{$el}.pages" => ['nullable', Rule::in(['all', 'first', 'last'])],
            "{$el}.follows" => ['nullable', 'string', 'max:60'],
            "{$el}.text" => ['nullable', 'string', 'max:5000'],
            "{$el}.fontSize" => ['nullable', 'numeric', 'min:4', 'max:72'],
            "{$el}.bold" => $flag,
            "{$el}.italic" => $flag,
            "{$el}.underline" => $flag,
            "{$el}.uppercase" => $flag,
            "{$el}.align" => $align,
            "{$el}.border" => ['nullable', Rule::in(['none', 'all', 'top', 'bottom'])],
            "{$el}.thickness" => ['nullable', 'numeric', 'min:0.1', 'max:5'],
            $table => ['nullable', 'array', "required_if:{$el}.type,table"],
            "{$table}.source" => ["required_with:{$table}", 'string', 'max:40'],
            "{$table}.showHeader" => $flag,
            "{$table}.rowLines" => $flag,
            "{$table}.columnLines" => $flag,
            "{$table}.repeatAcross" => ['nullable', 'integer', 'min:1', 'max:4'],
            "{$table}.columns" => ["required_with:{$table}", 'array', 'min:1', 'max:12'],
            "{$table}.columns.*.key" => ['required', 'string', 'max:40'],
            "{$table}.columns.*.label" => ['nullable', 'string', 'max:60'],
            "{$table}.columns.*.width" => ['required', 'numeric', 'min:1', 'max:100'],
            "{$table}.columns.*.align" => $align,
        ];
    }
}
