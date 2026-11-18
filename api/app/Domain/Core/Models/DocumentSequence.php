<?php

namespace App\Domain\Core\Models;

use Illuminate\Database\Eloquent\Model;

/** Use SequenceService to take numbers — never update next_number directly. */
class DocumentSequence extends Model
{
    protected $fillable = ['branch_id', 'doc_type', 'prefix', 'next_number', 'padding'];

    protected function casts(): array
    {
        return ['next_number' => 'integer', 'padding' => 'integer'];
    }
}
