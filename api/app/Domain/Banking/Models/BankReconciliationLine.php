<?php

namespace App\Domain\Banking\Models;

use App\Domain\Accounting\Models\JournalLine;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BankReconciliationLine extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['cleared_date' => 'date'];
    }

    public function journalLine(): BelongsTo
    {
        return $this->belongsTo(JournalLine::class);
    }
}
