<?php

namespace App\Domain\Pawning\Models;

use App\Domain\Core\Concerns\BelongsToBranch;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One arrears letter per (ticket, cycle, letter no). Postage is charged once. */
class ArrearsLetter extends Model
{
    use BelongsToBranch;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'due_date' => 'date',
            'issued_at' => 'datetime',
            'last_reprinted_at' => 'datetime',
            'postage_charge' => 'decimal:2',
            'service_charge' => 'decimal:2',
            'letter_no' => 'integer',
            'cycle_no' => 'integer',
        ];
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(PawnTicket::class, 'pawn_ticket_id');
    }

    public function issuer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'issued_by');
    }
}
