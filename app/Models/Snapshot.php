<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Snapshot extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'operation_item_id', 'product_id', 'phase', 'payload', 'diff',
        'schema_version', 'created_at', 'expires_at',
    ];

    protected $casts = [
        'payload' => 'array',
        'diff' => 'array',
        'created_at' => 'datetime',
        'expires_at' => 'datetime',
    ];

    public function operationItem(): BelongsTo
    {
        return $this->belongsTo(OperationItem::class);
    }
}
