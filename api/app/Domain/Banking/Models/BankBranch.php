<?php

namespace App\Domain\Banking\Models;

use App\Domain\Core\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BankBranch extends Model
{
    use Auditable;

    protected $fillable = ['bank_id', 'code', 'name'];

    public function bank(): BelongsTo
    {
        return $this->belongsTo(Bank::class);
    }
}
