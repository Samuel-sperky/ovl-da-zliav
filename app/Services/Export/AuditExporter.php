<?php

declare(strict_types=1);

namespace App\Services\Export;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Builder;

/**
 * Export auditu do CSV/JSON s filtrom, bez PII. Používa sa aj pred GDPR čistkou.
 */
final class AuditExporter
{
    private const COLUMNS = [
        'id', 'created_at', 'actor', 'source', 'action', 'mode',
        'product_id', 'operation_id', 'result', 'margin_override_reason', 'hash_self',
    ];

    /**
     * @param  array<string,mixed>  $filters  date_from,date_to,product_id,actor,mode,result
     */
    public function query(array $filters = []): Builder
    {
        return AuditLog::query()
            ->when($filters['date_from'] ?? null, fn (Builder $q, $v) => $q->whereDate('created_at', '>=', $v))
            ->when($filters['date_to'] ?? null, fn (Builder $q, $v) => $q->whereDate('created_at', '<=', $v))
            ->when($filters['product_id'] ?? null, fn (Builder $q, $v) => $q->where('product_id', $v))
            ->when($filters['actor'] ?? null, fn (Builder $q, $v) => $q->where('actor', $v))
            ->when($filters['mode'] ?? null, fn (Builder $q, $v) => $q->where('mode', $v))
            ->when($filters['result'] ?? null, fn (Builder $q, $v) => $q->where('result', $v))
            ->orderBy('id');
    }

    /**
     * @param  array<string,mixed>  $filters
     */
    public function toCsv(array $filters = []): string
    {
        $fh = fopen('php://temp', 'r+');
        fputcsv($fh, self::COLUMNS);
        $this->query($filters)->chunk(1000, function ($rows) use ($fh) {
            foreach ($rows as $row) {
                fputcsv($fh, [
                    $row->id,
                    $row->created_at?->toIso8601String(),
                    $row->actor,
                    $row->source,
                    $row->action,
                    $row->mode,
                    $row->product_id,
                    $row->operation_id,
                    $row->result,
                    $row->margin_override_reason,
                    $row->hash_self,
                ]);
            }
        });
        rewind($fh);

        return (string) stream_get_contents($fh);
    }

    /**
     * @param  array<string,mixed>  $filters
     */
    public function toJson(array $filters = []): string
    {
        $rows = [];
        $this->query($filters)->chunk(1000, function ($chunk) use (&$rows) {
            foreach ($chunk as $row) {
                $rows[] = [
                    'id' => $row->id,
                    'created_at' => $row->created_at?->toIso8601String(),
                    'actor' => $row->actor,
                    'source' => $row->source,
                    'action' => $row->action,
                    'mode' => $row->mode,
                    'product_id' => $row->product_id,
                    'operation_id' => $row->operation_id,
                    'params' => $row->params,
                    'response_summary' => $row->response_summary,
                    'result' => $row->result,
                    'margin_override_reason' => $row->margin_override_reason,
                    'snapshot_before_id' => $row->snapshot_before_id,
                    'snapshot_after_id' => $row->snapshot_after_id,
                    'hash_prev' => $row->hash_prev,
                    'hash_self' => $row->hash_self,
                ];
            }
        });

        return (string) json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
