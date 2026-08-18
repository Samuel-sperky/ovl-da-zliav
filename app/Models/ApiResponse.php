<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ApiResponse extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'operation_item_id', 'endpoint', 'http_status', 'normalized',
        'created_at', 'expires_at',
    ];

    protected $casts = [
        'normalized' => 'array',
        'http_status' => 'integer',
        'created_at' => 'datetime',
        'expires_at' => 'datetime',
    ];
}
