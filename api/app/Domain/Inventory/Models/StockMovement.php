<?php

namespace App\Domain\Inventory\Models;

use App\Domain\Core\Concerns\BelongsToBranch;
use Illuminate\Database\Eloquent\Model;

class StockMovement extends Model
{
    use BelongsToBranch;

    public const UPDATED_AT = null;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['moved_at' => 'datetime', 'qty_in' => 'decimal:3', 'qty_out' => 'decimal:3'];
    }
}
