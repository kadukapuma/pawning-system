<?php

namespace App\Domain\Sms\Models;

use App\Domain\Core\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;

/** Message text for one type in one language. */
class SmsTemplate extends Model
{
    use Auditable;

    protected $fillable = ['type', 'language', 'body', 'updated_by'];
}
