<?php

namespace App\Domain\Pawning\Models;

use App\Domain\Core\Concerns\Auditable;
use App\Domain\Core\Concerns\BelongsToBranch;
use App\Domain\Customers\Models\Customer;
use App\Domain\Masters\Models\PawnScheme;
use App\Domain\Masters\Models\PawnSchemeVersion;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Pawn ticket header. Change balances only through the pawning services. */
class PawnTicket extends Model
{
    use Auditable, BelongsToBranch;

    public const STATUS_ACTIVE = 'active';

    public const STATUS_REDEEMED = 'redeemed';

    public const STATUS_FORFEITED = 'forfeited';

    public const STATUS_CANCELLED = 'cancelled';

    protected $guarded = ['id'];

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
        'arrears_stage' => 'none',
        'letter_cycle' => 1,
        'is_blocked' => false,
        'is_opening' => false,
        'interest_carried' => '0.00',
        'interest_paid_cycle' => '0.00',
    ];

    /** Balances change through services; keep the audit log readable. */
    protected array $auditExclude = ['stock_checked_at'];

    protected function casts(): array
    {
        return [
            'pawn_date' => 'date',
            'cycle_start_date' => 'date',
            'maturity_date' => 'date',
            'gross_weight' => 'decimal:3',
            'net_weight' => 'decimal:3',
            'assessed_value' => 'decimal:2',
            'market_value' => 'decimal:2',
            'principal_original' => 'decimal:2',
            'principal_current' => 'decimal:2',
            'interest_carried' => 'decimal:2',
            'interest_paid_cycle' => 'decimal:2',
            'monthly_interest_rate' => 'decimal:4',
            'is_blocked' => 'boolean',
            'is_opening' => 'boolean',
            'valid_months' => 'integer',
            'letter_cycle' => 'integer',
            'blocked_at' => 'datetime',
            'forfeit_queued_at' => 'datetime',
            'redeemed_at' => 'datetime',
            'forfeited_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'stock_checked_at' => 'datetime',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function scheme(): BelongsTo
    {
        return $this->belongsTo(PawnScheme::class, 'scheme_id');
    }

    public function schemeVersion(): BelongsTo
    {
        return $this->belongsTo(PawnSchemeVersion::class, 'scheme_version_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(PawnTicketItem::class);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(PawnTransaction::class)->orderBy('txn_at')->orderBy('id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(PawnTicketEvent::class)->orderBy('event_at')->orderBy('id');
    }

    public function letters(): HasMany
    {
        return $this->hasMany(ArrearsLetter::class)->orderBy('cycle_no')->orderBy('letter_no');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }

    public function isSilver(): bool
    {
        return $this->scheme?->interest_method === PawnScheme::METHOD_SILVER;
    }

    public function scopeActive(Builder $q): Builder
    {
        return $q->where('status', self::STATUS_ACTIVE);
    }

    /** Find by receipt, ticket or stock number in the working branch. */
    public function scopeNumber(Builder $q, string $no): Builder
    {
        $no = trim($no);

        return $q->where(fn ($w) => $w->where('receipt_no', $no)->orWhere('ticket_no', $no)
            ->orWhere('stock_no', $no)->orWhere('legacy_receipt_no', $no));
    }
}
