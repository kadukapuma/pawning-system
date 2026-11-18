<?php

namespace App\Domain\Core\Models;

use App\Domain\Core\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

class Company extends Model
{
    use Auditable;

    protected $fillable = ['name', 'registration_no', 'address', 'phone', 'phone2', 'email', 'logo_path', 'receipt_footer'];

    /** The single company row. */
    public static function current(): self
    {
        return static::query()->firstOrFail();
    }
}
