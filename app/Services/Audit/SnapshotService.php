<?php

declare(strict_types=1);

namespace App\Services\Audit;

use App\Models\Snapshot;

/**
 * Ukladá getFull snapshot pred/po zápisom (dôkaz skutočného stavu) + diff kľúčových polí.
 */
final class SnapshotService
{
    /** Polia, ktoré snapshot drží (bez zákazníckych dát). */
    private const KEYS = [
        'reduction_percent', 'reduction_from', 'reduction_to',
        'margin', 'margin_percent', 'sell_price', 'sell_price_with_vat',
        'price', 'active', 'qty',
    ];

    /**
     * @param  array<string,mixed>  $getFullData
     * @param  array<string,mixed>|null  $beforePayload  pri "after" na výpočet diffu
     */
    public function capture(?int $operationItemId, int $productId, string $phase, array $getFullData, ?array $beforePayload = null): Snapshot
    {
        $payload = $this->pick($getFullData);
        $diff = $beforePayload !== null ? $this->diff($beforePayload, $payload) : null;

        $days = (int) config('sperky.retention.snapshots_days', 90);

        return Snapshot::create([
            'operation_item_id' => $operationItemId,
            'product_id' => $productId,
            'phase' => $phase,
            'payload' => $payload,
            'diff' => $diff,
            'schema_version' => 1,
            'created_at' => now(),
            'expires_at' => now()->addDays($days),
        ]);
    }

    /**
     * @param  array<string,mixed>  $data
     * @return array<string,mixed>
     */
    private function pick(array $data): array
    {
        $out = [];
        foreach (self::KEYS as $k) {
            if (array_key_exists($k, $data)) {
                $out[$k] = $data[$k];
            }
        }

        return $out;
    }

    /**
     * @param  array<string,mixed>  $before
     * @param  array<string,mixed>  $after
     * @return array<string,array{from:mixed,to:mixed}>
     */
    private function diff(array $before, array $after): array
    {
        $diff = [];
        foreach (self::KEYS as $k) {
            $b = $before[$k] ?? null;
            $a = $after[$k] ?? null;
            if ($b !== $a) {
                $diff[$k] = ['from' => $b, 'to' => $a];
            }
        }

        return $diff;
    }
}
