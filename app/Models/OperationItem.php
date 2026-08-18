<?php

declare(strict_types=1);

namespace App\Models;

use App\Enums\ItemState;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class OperationItem extends Model
{
    protected $fillable = [
        'operation_id', 'product_id', 'from', 'to', 'reduction',
        'override_reduction', 'override_reason', 'state', 'dedup_key',
        'error_code', 'attempts',
    ];

    protected $casts = [
        'from' => 'date',
        'to' => 'date',
        'reduction' => 'decimal:2',
        'override_reduction' => 'decimal:2',
        'state' => ItemState::class,
        'attempts' => 'integer',
    ];

    public function operation(): BelongsTo
    {
        return $this->belongsTo(Operation::class);
    }

    public function snapshots(): HasMany
    {
        return $this->hasMany(Snapshot::class);
    }

    /** Efektívna zľava = override, ak je zadaný, inak základná. */
    public function effectiveReduction(): ?string
    {
        return $this->override_reduction ?? $this->reduction;
    }
}
