<?php

namespace App\Domain\Sms\Models;

use App\Domain\Core\Concerns\Auditable;
use App\Domain\Sms\Enums\SmsType;
use Illuminate\Database\Eloquent\Model;

/** When one message type is sent. */
class SmsRule extends Model
{
    use Auditable;

    protected $fillable = ['type', 'mode', 'offsets', 'send_time', 'last_run_on', 'updated_by'];

    protected $attributes = ['mode' => SmsType::MODE_OFF, 'offsets' => null, 'send_time' => null, 'last_run_on' => null];

    /** The daily run marker is not an administrator change. */
    protected array $auditExclude = ['last_run_on'];

    protected function casts(): array
    {
        return ['offsets' => 'array', 'last_run_on' => 'date'];
    }

    public static function for(SmsType $type): self
    {
        return static::firstOrCreate(['type' => $type->value]);
    }

    public function isOff(): bool
    {
        return $this->mode === SmsType::MODE_OFF;
    }

    /** @return list<int> */
    public function days(): array
    {
        return array_map('intval', $this->offsets ?? []);
    }
}
