<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

// ŽIADNE PII — len agregáty na produkt. TTL riadi PurgeExpiredAggregatesJob (P9).
class OrderAggregate extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'product_id', 'units_sold', 'qty_in_orders', 'last_time_in_order',
        'sales_velocity', 'computed_at', 'expires_at',
    ];

    protected $casts = [
        'units_sold' => 'integer',
        'qty_in_orders' => 'integer',
        'last_time_in_order' => 'date',
        'sales_velocity' => 'decimal:4',
        'computed_at' => 'datetime',
        'expires_at' => 'datetime',
    ];
}
