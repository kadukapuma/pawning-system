<?php

namespace App\Domain\Sms\Models;

use App\Domain\Core\Concerns\BelongsToBranch;
use App\Domain\Customers\Models\Customer;
use App\Domain\Pawning\Models\PawnTicket;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One SMS: queued, then sent or failed. Change status only through SmsDispatcher. */
class SmsMessage extends Model
{
    use BelongsToBranch;

    public const QUEUED = 'queued';

    public const SENDING = 'sending';

    public const SENT = 'sent';

    public const FAILED = 'failed';

    public const CANCELLED = 'cancelled';

    public const STATUSES = [self::QUEUED, self::SENDING, self::SENT, self::FAILED, self::CANCELLED];

    protected $guarded = ['id'];

    protected $attributes = ['status' => self::QUEUED, 'error' => null, 'sent_at' => null];

    protected function casts(): array
    {
        return ['segments' => 'integer', 'queued_at' => 'datetime', 'sent_at' => 'datetime'];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class)->withTrashed();
    }

    public function ticket(): BelongsTo
    {
        // History can list messages of every branch's tickets (console, retries).
        return $this->belongsTo(PawnTicket::class, 'pawn_ticket_id')->withoutGlobalScope('branch');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
