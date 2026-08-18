<?php

declare(strict_types=1);

namespace App\Services\Batch;

use App\Enums\ItemState;
use App\Jobs\ApplyReductionJob;
use App\Jobs\ClearReductionJob;
use App\Models\Operation;
use App\Models\OperationItem;

/**
 * Zostaví dávku (operáciu + položky) a po potvrdení dispatchne joby v deterministickom poradí.
 */
final class BatchRunner
{
    /**
     * @param  list<array{product_id:int, reduction?:float, override_reduction?:?float, override_reason?:?string}>  $rows
     */
    public function createBatch(array $rows, ?string $from, ?string $to, string $type = 'set', string $source = 'manual', ?string $actor = null, ?int $campaignId = null): Operation
    {
        $op = Operation::create([
            'source' => $source,
            'campaign_id' => $campaignId,
            'type' => $type,
            'mode' => 'dry_run',
            'actor' => $actor,
            'summary' => ['total' => count($rows)],
        ]);

        foreach ($rows as $row) {
            $reduction = isset($row['reduction']) ? (float) $row['reduction'] : null;
            OperationItem::create([
                'operation_id' => $op->id,
                'product_id' => (int) $row['product_id'],
                'from' => $from,
                'to' => $to,
                'reduction' => $reduction,
                'override_reduction' => $row['override_reduction'] ?? null,
                'override_reason' => $row['override_reason'] ?? null,
                'state' => ItemState::Pending,
                'dedup_key' => sprintf('%d|%s|%s|%s', $row['product_id'], $from, $to, $row['override_reduction'] ?? $reduction),
            ]);
        }

        return $op;
    }

    /**
     * Potvrdenie → reálny beh. Dispatch v poradí podľa product_id (deterministické).
     */
    public function confirmAndRun(Operation $op): void
    {
        $op->update(['mode' => 'real']);

        $items = $op->items()
            ->whereIn('state', [ItemState::Pending->value, ItemState::DryRunOk->value, ItemState::AwaitingConfirm->value])
            ->orderBy('product_id')
            ->get();

        foreach ($items as $item) {
            $item->update(['state' => ItemState::Queued]);
            $this->dispatchFor($op->type, (int) $item->id);
        }
    }

    private function dispatchFor(string $type, int $itemId): void
    {
        match ($type) {
            'clear' => ClearReductionJob::dispatch($itemId),
            default => ApplyReductionJob::dispatch($itemId),
        };
    }
}
