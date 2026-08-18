<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Operation extends Model
{
    protected $fillable = ['source', 'campaign_id', 'type', 'mode', 'summary', 'actor'];

    protected $casts = [
        'summary' => 'array',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(OperationItem::class);
    }

    public function isDryRun(): bool
    {
        return $this->mode === 'dry_run';
    }
}
