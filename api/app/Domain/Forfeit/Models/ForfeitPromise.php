<?php

namespace App\Domain\Forfeit\Models;

use App\Domain\Pawning\Models\PawnTicket;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A customer's promise to pay before forfeiture. Can be extended only before
 * the promise date arrives (the old promise is kept as "extended").
 */
class ForfeitPromise extends Model
{
    public const PENDING = 'pending';

    public const EXTENDED = 'extended';

    public const KEPT = 'kept';

    public const BROKEN = 'broken';

    protected $guarded = ['id'];

    protected $attributes = ['status' => self::PENDING];

    protected function casts(): array
    {
        return ['promise_date' => 'date', 'cycle_no' => 'integer'];
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(PawnTicket::class, 'pawn_ticket_id');
    }

    public function previous(): BelongsTo
    {
        return $this->belongsTo(self::class, 'previous_promise_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isOverdue(): bool
    {
        return $this->status === self::PENDING && $this->promise_date->lt(today());
    }

    /** Called when the customer pays (part payment, renewal, redemption). */
    public static function markKept(PawnTicket $ticket): void
    {
        static::where('pawn_ticket_id', $ticket->id)->where('status', self::PENDING)
            ->update(['status' => self::KEPT, 'updated_by' => auth()->id(), 'updated_at' => now()]);
    }
}
