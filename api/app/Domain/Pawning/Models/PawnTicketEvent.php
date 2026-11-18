<?php

namespace App\Domain\Pawning\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Lifecycle timeline entry (pawned, part paid, blocked, letter issued, ...). */
class PawnTicketEvent extends Model
{
    public const UPDATED_AT = null;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['event_at' => 'datetime', 'amount' => 'decimal:2', 'payload' => 'array'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public static function record(PawnTicket $ticket, string $type, ?string $description = null, string|float|null $amount = null, array $payload = []): self
    {
        return static::create([
            'pawn_ticket_id' => $ticket->id,
            'event_type' => $type,
            'event_at' => now(),
            'amount' => $amount,
            'description' => $description,
            'payload' => $payload ?: null,
            'user_id' => auth()->id(),
        ]);
    }
}
