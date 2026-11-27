<?php

namespace App\Domain\Printing\Models;

use App\Domain\Core\Concerns\Auditable;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A Print Designer layout for one printed document. */
class PrintDesign extends Model
{
    use Auditable;

    /** Documents the Print Designer can lay out (keys shared with the web app). */
    public const DOCUMENTS = [
        'pawn_ticket',
        'pawn_receipt',
        'arrears_letter',
        'sales_invoice',
        'stock_transfer',
    ];

    protected $fillable = ['document_key', 'template', 'active', 'updated_by'];

    /** The template JSON is large; the audit log records who changed what and when. */
    protected array $auditExclude = ['template'];

    protected $casts = [
        'template' => 'array',
        'active' => 'boolean',
    ];

    public function editor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    /** What the designer screen shows about a saved design. */
    public function summary(): array
    {
        return [
            'document_key' => $this->document_key,
            'active' => $this->active,
            'updated_by' => $this->editor?->name,
            'updated_at' => $this->updated_at,
        ];
    }
}
