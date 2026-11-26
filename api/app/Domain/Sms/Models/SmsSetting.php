<?php

namespace App\Domain\Sms\Models;

use App\Domain\Core\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** Company-wide SMS switches (one row). */
class SmsSetting extends Model
{
    use Auditable;

    protected $fillable = ['enabled', 'default_language', 'updated_by'];

    protected $attributes = ['enabled' => false, 'default_language' => 'en'];

    protected function casts(): array
    {
        return ['enabled' => 'boolean'];
    }

    public static function current(): self
    {
        return static::query()->first() ?? static::create([]);
    }
}
