<?php

namespace App\Domain\Inventory\Models;

use App\Domain\Core\Concerns\BelongsToBranch;
use App\Domain\Forfeit\Models\Forfeiture;
use App\Domain\Masters\Models\ArticleCategory;
use App\Domain\Masters\Models\ArticleType;
use App\Domain\Masters\Models\Karat;
use App\Domain\Pawning\Models\PawnTicketItem;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** An article in sale stock (from a forfeited ticket). */
class InventoryItem extends Model
{
    use BelongsToBranch;

    public const IN_STOCK = 'in_stock';

    public const SOLD = 'sold';

    protected $guarded = ['id'];

    protected $attributes = ['status' => self::IN_STOCK];

    protected function casts(): array
    {
        return [
            'gross_weight' => 'decimal:3',
            'net_weight' => 'decimal:3',
            'cost_price' => 'decimal:2',
            'sale_price' => 'decimal:2',
            'quantity' => 'integer',
            'received_at' => 'datetime',
            'sold_at' => 'datetime',
        ];
    }

    public function forfeiture(): BelongsTo
    {
        return $this->belongsTo(Forfeiture::class);
    }

    public function pawnTicketItem(): BelongsTo
    {
        return $this->belongsTo(PawnTicketItem::class);
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(StockTransferBatch::class, 'transfer_batch_id');
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(ArticleCategory::class, 'category_id');
    }

    public function articleType(): BelongsTo
    {
        return $this->belongsTo(ArticleType::class);
    }

    public function karat(): BelongsTo
    {
        return $this->belongsTo(Karat::class);
    }

    public function movements(): HasMany
    {
        return $this->hasMany(StockMovement::class)->orderBy('moved_at');
    }
}
