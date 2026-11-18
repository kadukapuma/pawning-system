<?php

namespace App\Domain\Inventory\Models;

use App\Domain\Core\Concerns\BelongsToBranch;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** One "transfer forfeited articles to sale stock" run. */
class StockTransferBatch extends Model
{
    use BelongsToBranch;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['transferred_at' => 'datetime'];
    }

    public function items(): HasMany
    {
        return $this->hasMany(InventoryItem::class, 'transfer_batch_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
