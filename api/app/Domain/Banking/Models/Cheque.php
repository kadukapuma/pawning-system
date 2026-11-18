<?php

namespace App\Domain\Banking\Models;

use App\Domain\Accounting\Models\Account;
use App\Domain\Core\Concerns\Auditable;
use App\Domain\Core\Concerns\BelongsToBranch;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Received cheque: in_hand → deposited → cleared | returned.
 * Issued cheque:   issued → presented (cleared) | cancelled.
 * `source_type/source_id` = the ledger account the cheque was for.
 */
class Cheque extends Model
{
    use Auditable, BelongsToBranch;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'cheque_date' => 'date',
            'deposited_at' => 'datetime',
            'cleared_at' => 'datetime',
            'returned_at' => 'datetime',
        ];
    }

    public function bankBranch(): BelongsTo
    {
        return $this->belongsTo(BankBranch::class);
    }

    public function bankAccount(): BelongsTo
    {
        return $this->belongsTo(BankAccount::class);
    }

    /** The other side of the cheque (income / expense / customer account). */
    public function counterAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'source_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
