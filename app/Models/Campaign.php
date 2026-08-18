<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Campaign extends Model
{
    protected $fillable = [
        'name', 'set_type', 'product_ids', 'filter', 'reduction',
        'from', 'to', 'status', 'frozen_product_ids', 'dry_run_snapshot',
        'created_by', 'armed_at',
    ];

    protected $casts = [
        'product_ids' => 'array',
        'filter' => 'array',
        'frozen_product_ids' => 'array',
        'dry_run_snapshot' => 'array',
        'reduction' => 'decimal:2',
        'from' => 'date',
        'to' => 'date',
        'armed_at' => 'datetime',
    ];

    public function operations(): HasMany
    {
        return $this->hasMany(Operation::class);
    }
}
