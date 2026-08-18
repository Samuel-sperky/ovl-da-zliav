<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Append-only. Bez updated_at. Aktualizácie/mazanie sú zablokované na úrovni modelu
 * (integritu reťaze overuje HashChain v P6).
 */
class AuditLog extends Model
{
    protected $table = 'audit_log';

    public const UPDATED_AT = null;

    protected $fillable = [
        'actor', 'source', 'action', 'product_id', 'operation_id', 'mode',
        'params', 'response_summary', 'result', 'margin_override_reason',
        'snapshot_before_id', 'snapshot_after_id', 'hash_prev', 'hash_self',
        'schema_version', 'created_at',
    ];

    protected $casts = [
        'params' => 'array',
        'response_summary' => 'array',
        'created_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        // Append-only poistka na úrovni ORM.
        static::updating(fn () => throw new \RuntimeException('audit_log je append-only'));
        static::deleting(fn () => throw new \RuntimeException('audit_log je append-only'));
    }
}
