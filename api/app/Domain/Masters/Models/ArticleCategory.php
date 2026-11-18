<?php

namespace App\Domain\Masters\Models;

use App\Domain\Core\Concerns\Auditable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ArticleCategory extends Model
{
    use Auditable;

    protected $fillable = ['name', 'metal', 'is_active'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function types(): HasMany
    {
        return $this->hasMany(ArticleType::class, 'category_id');
    }
}
