<?php

declare(strict_types=1);

namespace App\Services\Audit;

use App\Models\AuditLog;
use Illuminate\Support\Facades\DB;

/**
 * Append-only zapisovač auditu s hash-reťazou. Redaguje citlivé polia.
 */
final class AuditRecorder
{
    /** Kľúče, ktoré sa nikdy nesmú dostať do auditu. */
    private const REDACT = ['x-api-key', 'authorization', 'api_key', 'apikey', 'key', 'password'];

    public function __construct(private readonly HashChain $chain) {}

    /**
     * @param  array<string,mixed>  $fields
     */
    public function record(array $fields): AuditLog
    {
        return DB::transaction(function () use ($fields) {
            $prev = AuditLog::query()->orderByDesc('id')->lockForUpdate()->first();
            $hashPrev = $prev?->hash_self;

            $payload = [
                'actor' => $fields['actor'] ?? null,
                'source' => $fields['source'] ?? 'system',
                'action' => $fields['action'],
                'product_id' => $fields['product_id'] ?? null,
                'operation_id' => $fields['operation_id'] ?? null,
                'mode' => $fields['mode'] ?? 'real',
                'params' => $this->redact((array) ($fields['params'] ?? [])),
                'response_summary' => $this->redact((array) ($fields['response_summary'] ?? [])),
                'result' => $fields['result'] ?? null,
                'margin_override_reason' => $fields['margin_override_reason'] ?? null,
                'snapshot_before_id' => $fields['snapshot_before_id'] ?? null,
                'snapshot_after_id' => $fields['snapshot_after_id'] ?? null,
                'schema_version' => 1,
                'created_at' => now()->toIso8601String(),
            ];

            $hashSelf = $this->chain->compute($hashPrev, $payload);

            return AuditLog::create($payload + [
                'hash_prev' => $hashPrev,
                'hash_self' => $hashSelf,
            ]);
        });
    }

    /**
     * Overí integritu celej reťaze.
     *
     * @return array{ok:bool, broken_at:?int}
     */
    public function verifyChain(): array
    {
        $prevHash = null;
        $broken = null;

        AuditLog::query()->orderBy('id')->chunk(500, function ($rows) use (&$prevHash, &$broken) {
            foreach ($rows as $row) {
                $payload = [
                    'actor' => $row->actor,
                    'source' => $row->source,
                    'action' => $row->action,
                    'product_id' => $row->product_id,
                    'operation_id' => $row->operation_id,
                    'mode' => $row->mode,
                    'params' => $row->params ?? [],
                    'response_summary' => $row->response_summary ?? [],
                    'result' => $row->result,
                    'margin_override_reason' => $row->margin_override_reason,
                    'snapshot_before_id' => $row->snapshot_before_id,
                    'snapshot_after_id' => $row->snapshot_after_id,
                    'schema_version' => $row->schema_version,
                    'created_at' => $row->created_at?->toIso8601String(),
                ];
                $expected = $this->chain->compute($prevHash, $payload);
                if ($row->hash_prev !== $prevHash || $row->hash_self !== $expected) {
                    $broken = $row->id;

                    return false;
                }
                $prevHash = $row->hash_self;
            }

            return true;
        });

        return ['ok' => $broken === null, 'broken_at' => $broken];
    }

    /**
     * @param  array<string,mixed>  $data
     * @return array<string,mixed>
     */
    private function redact(array $data): array
    {
        foreach ($data as $k => $v) {
            if (in_array(strtolower((string) $k), self::REDACT, true)) {
                $data[$k] = '[redacted]';
            } elseif (is_array($v)) {
                $data[$k] = $this->redact($v);
            }
        }

        return $data;
    }
}
