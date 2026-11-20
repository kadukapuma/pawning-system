<?php

namespace App\Domain\Pawning\Models;

use App\Domain\Masters\Models\ArticleCategory;
use App\Domain\Masters\Models\ArticleCondition;
use App\Domain\Masters\Models\ArticleType;
use App\Domain\Masters\Models\Karat;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PawnTicketItem extends Model
{
    protected $guarded = ['id'];

    protected $attributes = ['status' => 'pledged'];

    protected function casts(): array
    {
        return [
            'quantity' => 'integer',
            'gross_weight' => 'decimal:3',
            'net_weight' => 'decimal:3',
            'density_reading' => 'decimal:3',
            'karat_rate_per_8g' => 'decimal:2',
            'assessed_value' => 'decimal:2',
            'market_value' => 'decimal:2',
        ];
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(PawnTicket::class, 'pawn_ticket_id');
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(ArticleCategory::class, 'category_id');
    }

    public function articleType(): BelongsTo
    {
        return $this->belongsTo(ArticleType::class);
    }

    public function condition(): BelongsTo
    {
        return $this->belongsTo(ArticleCondition::class, 'condition_id');
    }

    public function karat(): BelongsTo
    {
        return $this->belongsTo(Karat::class);
    }
}
