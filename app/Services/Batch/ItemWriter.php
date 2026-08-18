<?php

declare(strict_types=1);

namespace App\Services\Batch;

use App\Enums\ItemState;
use App\Models\ApiResponse;
use App\Models\OperationItem;
use App\Models\Snapshot;
use App\Services\Api\NormalizedResponse;
use App\Services\Api\SperkyClient;
use App\Services\Api\WhoamiService;
use App\Services\Audit\AuditRecorder;
use App\Services\Audit\SnapshotService;

/**
 * Vykoná JEDEN reálny zápis (set/clear) so snapshotmi pred/po, read-after-write,
 * fail-closed, flash-sale skip a plným auditom. Volané z jobov (serializované jedným workerom).
 */
final class ItemWriter
{
    public function __construct(
        private readonly SperkyClient $client,
        private readonly WhoamiService $whoami,
        private readonly SnapshotService $snapshots,
        private readonly AuditRecorder $audit,
    ) {}

    public function applyItem(OperationItem $item): void
    {
        $this->execute($item, 'set');
    }

    public function clearItem(OperationItem $item): void
    {
        $this->execute($item, 'clear');
    }

    private function execute(OperationItem $item, string $action): void
    {
        // Idempotencia: už zapísané/preskočené položky neopakuj.
        if (in_array($item->state, [ItemState::Sent, ItemState::Verified, ItemState::Compensated, ItemState::SkippedFlashSale], true)) {
            return;
        }

        $pid = (int) $item->product_id;

        // Fail-closed poistky.
        if ((bool) config('sperky.guards.kill_switch', false)) {
            $this->fail($item, 'kill_switch', $action);

            return;
        }
        if (! $this->whoami->canWrite()) {
            $this->fail($item, 'forbidden', $action);

            return;
        }

        // Snapshot "pred" (baseline pre read-after-write aj kompenzáciu).
        $beforePayload = null;
        $beforeSnap = null;
        $beforeResp = $this->client->getFull($pid);
        if ($beforeResp->success) {
            $beforeSnap = $this->snapshots->capture($item->id, $pid, 'before', $beforeResp->data);
            $beforePayload = $beforeSnap->payload;
        }

        // Samotný zápis.
        $reduction = (float) $item->effectiveReduction();
        $from = optional($item->from)->format('Y-m-d');
        $to = optional($item->to)->format('Y-m-d');

        $resp = $action === 'set'
            ? $this->client->setReduction($pid, (string) $from, (string) $to, $reduction)
            : $this->client->clearReduction($pid);

        $this->storeResponse($item, $action === 'set' ? 'setReduction' : 'clearReduction', $resp);

        // Flash sale → skip, pokračuj v dávke.
        if ($resp->isFlashSaleBlocked()) {
            $this->transition($item, ItemState::SkippedFlashSale, 'blocked_by_flash_sale');
            $this->recordAudit($item, $action, 'skipped', $resp, $beforeSnap?->id, null);

            return;
        }
        if ($resp->isForbidden()) {
            $this->fail($item, 'forbidden', $action, $resp, $beforeSnap?->id);

            return;
        }
        if (! $resp->success) {
            $this->fail($item, $resp->firstError() ?? 'request_failed', $action, $resp, $beforeSnap?->id);

            return;
        }

        $this->transition($item, ItemState::Sent);

        // Read-after-write.
        $afterResp = $this->client->getFull($pid);
        $afterSnap = null;
        if ($afterResp->success) {
            $afterSnap = $this->snapshots->capture($item->id, $pid, 'after', $afterResp->data, $beforePayload);
            $ok = $this->verify($action, $afterResp->data, $reduction, (string) $from, (string) $to);
            $this->transition($item, $ok ? ItemState::Verified : ItemState::Uncertain);
        } else {
            // Nevieme potvrdiť skutočný stav → uncertain (rieši reconciliation).
            $this->transition($item, ItemState::Uncertain, 'verify_read_failed');
        }

        $this->recordAudit($item, $action, $item->state === ItemState::Verified ? 'ok' : 'uncertain', $resp, $beforeSnap?->id, $afterSnap?->id);
    }

    private function verify(string $action, array $after, float $reduction, string $from, string $to): bool
    {
        if ($action === 'clear') {
            return ($after['reduction_percent'] ?? null) === null;
        }
        $rp = $after['reduction_percent'] ?? null;
        if ($rp === null) {
            return false;
        }

        return abs((float) $rp - $reduction) < 0.01
            && (string) ($after['reduction_from'] ?? '') === $from
            && (string) ($after['reduction_to'] ?? '') === $to;
    }

    private function fail(OperationItem $item, string $code, string $action, ?NormalizedResponse $resp = null, ?int $beforeSnapId = null): void
    {
        $this->transition($item, ItemState::Failed, $code);
        $this->recordAudit($item, $action, 'failed', $resp, $beforeSnapId, null);
    }

    private function transition(OperationItem $item, ItemState $to, ?string $errorCode = null): void
    {
        // Stavový automat je poradca; ak prechod nie je povolený, zaznamenáme, ale stav nastavíme
        // (reálne zlyhania môžu preskočiť medzistavy).
        $item->state = $to;
        if ($errorCode !== null) {
            $item->error_code = $errorCode;
        }
        $item->save();
    }

    private function storeResponse(OperationItem $item, string $endpoint, NormalizedResponse $resp): void
    {
        ApiResponse::create([
            'operation_item_id' => $item->id,
            'endpoint' => $endpoint,
            'http_status' => $resp->httpStatus,
            'normalized' => [
                'success' => $resp->success,
                'error_codes' => $resp->errorCodes,
                // bez surových zákazníckych polí a bez kľúča
            ],
            'created_at' => now(),
            'expires_at' => now()->addDays((int) config('sperky.retention.snapshots_days', 90)),
        ]);
    }

    private function recordAudit(OperationItem $item, string $action, string $result, ?NormalizedResponse $resp, ?int $beforeSnapId, ?int $afterSnapId): void
    {
        $this->audit->record([
            'actor' => optional($item->operation)->actor,
            'source' => optional($item->operation)->source ?? 'system',
            'action' => $action,
            'product_id' => $item->product_id,
            'operation_id' => $item->operation_id,
            'mode' => 'real',
            'params' => [
                'id' => $item->product_id,
                'from' => optional($item->from)->format('Y-m-d'),
                'to' => optional($item->to)->format('Y-m-d'),
                'reduction' => $item->effectiveReduction(),
            ],
            'response_summary' => $resp ? ['success' => $resp->success, 'error_codes' => $resp->errorCodes] : [],
            'result' => $result,
            'margin_override_reason' => $item->override_reason,
            'snapshot_before_id' => $beforeSnapId,
            'snapshot_after_id' => $afterSnapId,
        ]);
    }
}
