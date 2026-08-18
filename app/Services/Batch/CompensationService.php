<?php

declare(strict_types=1);

namespace App\Services\Batch;

use App\Enums\ItemState;
use App\Jobs\ApplyReductionJob;
use App\Jobs\ClearReductionJob;
use App\Models\Operation;
use App\Models\OperationItem;
use App\Models\Snapshot;

/**
 * Kompenzácia pri čiastočnom zlyhaní dávky (NIE rollback).
 * Voľba operátora: dokončiť zvyšné, alebo vrátiť už zapísané do stavu zo snapshotu.
 */
final class CompensationService
{
    /** Dokonči ešte nezapísané položky pôvodnej dávky. */
    public function completeRemaining(Operation $op): void
    {
        $items = $op->items()
            ->whereIn('state', [ItemState::Pending->value, ItemState::DryRunOk->value, ItemState::AwaitingConfirm->value, ItemState::Queued->value, ItemState::Uncertain->value])
            ->orderBy('product_id')
            ->get();

        foreach ($items as $item) {
            $item->update(['state' => ItemState::Queued]);
            $op->type === 'clear'
                ? ClearReductionJob::dispatch((int) $item->id)
                : ApplyReductionJob::dispatch((int) $item->id);
        }
    }

    /**
     * Vráť už zapísané položky do pôvodného stavu zo snapshotu "before".
     * Ak pred zápisom bola iná percentuálna zľava → obnov ju; inak zruš.
     */
    public function revert(Operation $op, ?string $actor = null): Operation
    {
        $written = $op->items()
            ->whereIn('state', [ItemState::Sent->value, ItemState::Verified->value, ItemState::Uncertain->value])
            ->orderBy('product_id')
            ->get();

        $comp = Operation::create([
            'source' => $op->source,
            'campaign_id' => $op->campaign_id,
            'type' => 'compensate',
            'mode' => 'real',
            'actor' => $actor ?? $op->actor,
            'summary' => ['total' => $written->count(), 'compensates_operation' => $op->id],
        ]);

        foreach ($written as $item) {
            $before = Snapshot::query()
                ->where('operation_item_id', $item->id)
                ->where('phase', 'before')
                ->latest('id')
                ->first();

            $oldPct = $before?->payload['reduction_percent'] ?? null;
            $oldFrom = $before?->payload['reduction_from'] ?? null;
            $oldTo = $before?->payload['reduction_to'] ?? null;

            $restore = $oldPct !== null && $oldFrom && $oldTo;

            $compItem = OperationItem::create([
                'operation_id' => $comp->id,
                'product_id' => $item->product_id,
                'from' => $restore ? $oldFrom : null,
                'to' => $restore ? $oldTo : null,
                'reduction' => $restore ? (float) $oldPct : null,
                'state' => ItemState::Queued,
                'dedup_key' => 'comp-'.$item->id,
            ]);

            $item->update(['state' => ItemState::Compensated]);

            $restore
                ? ApplyReductionJob::dispatch((int) $compItem->id)
                : ClearReductionJob::dispatch((int) $compItem->id);
        }

        return $comp;
    }
}
