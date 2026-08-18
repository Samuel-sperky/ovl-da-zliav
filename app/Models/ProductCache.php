<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductCache extends Model
{
    protected $table = 'products_cache';

    protected $fillable = [
        'product_id', 'name', 'price', 'has_attributes', 'payload', 'fetched_at',
    ];

    protected $casts = [
        'price' => 'decimal:4',
        'has_attributes' => 'boolean',
        'payload' => 'array',
        'fetched_at' => 'datetime',
    ];
}
