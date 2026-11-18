<?php

namespace App\Domain\Accounting\Models;

use App\Domain\Core\Concerns\Auditable;
use App\Domain\Core\Concerns\BelongsToBranch;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Payment / receipt / expense / petty-cash voucher. Maker-checker: the person
 * who approves cannot be the one who requested; only approval posts the journal.
 */
class Voucher extends Model
{
    use Auditable, BelongsToBranch;

    public const TYPES = ['payment', 'receipt', 'expense', 'petty_cash'];

    public const PENDING = 'pending';

    public const POSTED = 'posted';

    public const REJECTED = 'rejected';

    protected $guarded = ['id'];

    protected $attributes = ['status' => self::PENDING];

    protected function casts(): array
    {
        return ['voucher_date' => 'date', 'amount' => 'decimal:2', 'approved_at' => 'datetime'];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function cashAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'cash_account_id');
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function journal(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    /** Money leaves the cash/bank account for everything except receipts. */
    public function isOutflow(): bool
    {
        return $this->type !== 'receipt';
    }
}
