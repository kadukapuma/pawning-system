<?php

namespace App\Domain\Masters\Models;

use App\Domain\Core\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ArticleType extends Model
{
    use Auditable;

    protected $fillable = ['category_id', 'code', 'name', 'sub_category', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(ArticleCategory::class, 'category_id');
    }
}
