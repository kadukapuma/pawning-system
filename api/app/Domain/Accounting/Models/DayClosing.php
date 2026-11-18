<?php

namespace App\Domain\Accounting\Models;

use App\Domain\Core\Concerns\BelongsToBranch;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One per branch per business day. A closed day accepts no more postings. */
class DayClosing extends Model
{
    use BelongsToBranch;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        $money = array_fill_keys(['opening_cash', 'total_in', 'total_out', 'closing_cash', 'physical_cash', 'variance'], 'decimal:2');

        return $money + ['business_date' => 'date', 'closed_at' => 'datetime'];
    }

    public function closer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }
}
