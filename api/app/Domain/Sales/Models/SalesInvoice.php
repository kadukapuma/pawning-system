<?php

namespace App\Domain\Sales\Models;

use App\Domain\Core\Concerns\Auditable;
use App\Domain\Core\Concerns\BelongsToBranch;
use App\Domain\Customers\Models\Customer;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SalesInvoice extends Model
{
    use Auditable, BelongsToBranch;

    public const COMPLETED = 'completed';

    public const VOIDED = 'voided';

    protected $guarded = ['id'];

    protected $attributes = ['status' => self::COMPLETED];

    protected function casts(): array
    {
        $money = array_fill_keys(['gross_amount', 'discount', 'net_amount', 'paid_cash', 'paid_card', 'paid_cheque', 'credit_amount'], 'decimal:2');

        return $money + ['invoice_date' => 'datetime', 'voided_at' => 'datetime'];
    }

    public function lines(): HasMany
    {
        return $this->hasMany(SalesInvoiceLine::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function voider(): BelongsTo
    {
        return $this->belongsTo(User::class, 'voided_by');
    }
}
