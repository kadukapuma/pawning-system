<?php

namespace App\Domain\Pawning\Models;

use App\Domain\Accounting\Models\JournalEntry;
use App\Domain\Core\Concerns\BelongsToBranch;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One money event on a ticket. Immutable once written (corrections = reversal rows). */
class PawnTransaction extends Model
{
    use BelongsToBranch;

    public const PAWN = 'pawn';

    public const OPENING = 'opening';

    public const PART_PAYMENT = 'part_payment';

    public const RENEWAL = 'renewal';

    public const REDEMPTION = 'redemption';

    public const ROUNDING = 'rounding';

    public const CANCELLATION = 'cancellation';

    /** Sequence used for txn_no per type. */
    public const SEQUENCE = [
        self::PAWN => 'pawn_txn',
        self::OPENING => 'pawn_txn',
        self::PART_PAYMENT => 'part_payment',
        self::RENEWAL => 'renewal',
        self::REDEMPTION => 'redemption',
        self::ROUNDING => 'rounding',
        self::CANCELLATION => 'cancellation',
    ];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        $money = array_fill_keys([
            'principal_before', 'interest_due', 'interest_paid', 'interest_capitalised', 'service_charge',
            'postage_charge', 'document_charge', 'stamp_duty', 'discount', 'principal_paid', 'principal_added',
            'principal_after', 'cash_received', 'cash_paid',
        ], 'decimal:2');

        return $money + [
            'txn_at' => 'datetime',
            'business_date' => 'date',
            'new_maturity_date' => 'date',
            'interest_days' => 'integer',
        ];
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(PawnTicket::class, 'pawn_ticket_id');
    }

    public function journal(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
