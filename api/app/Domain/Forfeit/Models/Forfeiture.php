<?php

namespace App\Domain\Forfeit\Models;

use App\Domain\Core\Concerns\BelongsToBranch;
use App\Domain\Inventory\Models\InventoryItem;
use App\Domain\Pawning\Models\PawnTicket;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** The figures frozen at the moment a ticket was forfeited. */
class Forfeiture extends Model
{
    use BelongsToBranch;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'forfeit_date' => 'date',
            'principal_at_forfeit' => 'decimal:2',
            'interest_at_forfeit' => 'decimal:2',
            'charges_at_forfeit' => 'decimal:2',
            'total_due' => 'decimal:2',
        ];
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(PawnTicket::class, 'pawn_ticket_id');
    }

    public function inventoryItems(): HasMany
    {
        return $this->hasMany(InventoryItem::class);
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}
