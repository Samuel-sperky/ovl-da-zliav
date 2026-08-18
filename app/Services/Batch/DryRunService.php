<?php

declare(strict_types=1);

namespace App\Services\Batch;

use App\Services\Api\SperkyClient;

/**
 * Zostaví dry-run náhľad dávky "pred → po": batch getFull, marža po zľave,
 * konflikty s existujúcou zľavou, neaktívne/vypredané, nízka marža.
 * NEROBÍ žiadny zápis.
 */
final class DryRunService
{
    public function __construct(
        private readonly SperkyClient $client,
        private readonly PreflightValidator $preflight,
        private readonly MarginGuard $margin,
    ) {}

    /**
     * @param  list<array{product_id:int, reduction:float}>  $items  reduction už vyriešená (base/override)
     * @return array{rows:list<array<string,mixed>>, summary:array<string,int>}
     */
    public function run(array $items, string $from, string $to): array
    {
        $ids = array_values(array_unique(array_map(fn ($i) => (int) $i['product_id'], $items)));
        $full = $this->client->getFullBatch($ids);

        $rows = [];
        $summary = [
            'total' => 0, 'blocked' => 0, 'conflicts' => 0,
            'inactive' => 0, 'qty_zero' => 0, 'invalid' => 0, 'margin_unknown' => 0,
        ];

        foreach ($items as $item) {
            $pid = (int) $item['product_id'];
            $reduction = (float) $item['reduction'];
            $resp = $full[$pid] ?? null;
            $summary['total']++;

            $errors = $this->preflight->validate($reduction, $from, $to);

            if ($resp === null || ! $resp->success) {
                $rows[] = $this->row($pid, null, $reduction, $from, $to, $errors, $resp?->firstError() ?? 'not_found');
                $summary['invalid']++;

                continue;
            }

            $d = $resp->data;
            $row = $this->row($pid, $d, $reduction, $from, $to, $errors, null);
            $rows[] = $row;

            if (! $row['valid']) {
                $summary['invalid']++;
            }
            if ($row['conflict']) {
                $summary['conflicts']++;
            }
            if ($row['inactive']) {
                $summary['inactive']++;
            }
            if ($row['qty_zero']) {
                $summary['qty_zero']++;
            }
            if ($row['margin_unknown']) {
                $summary['margin_unknown']++;
            }
            if ($row['blocked']) {
                $summary['blocked']++;
            }
        }

        return ['rows' => $rows, 'summary' => $summary];
    }

    /**
     * @param  array<string,mixed>|null  $d  getFull data
     * @param  list<string>  $errors
     * @return array<string,mixed>
     */
    private function row(int $pid, ?array $d, float $reduction, string $from, string $to, array $errors, ?string $fetchError): array
    {
        $vatBefore = $d['sell_price_with_vat'] ?? null;
        $vatAfter = $vatBefore !== null ? round((float) $vatBefore * (1 - $reduction / 100), 2) : null;

        $marginEval = $d !== null
            ? $this->margin->evaluate($d, $reduction)
            : ['margin_percent' => null, 'blocked' => false, 'unknown' => true];

        $conflict = $d !== null && ($d['reduction_percent'] ?? null) !== null;
        $inactive = $d !== null && array_key_exists('active', $d) && ! $d['active'];
        $qtyZero = $d !== null && array_key_exists('qty', $d) && (int) $d['qty'] === 0;

        $valid = $errors === [] && $fetchError === null;

        return [
            'product_id' => $pid,
            'name' => $d['name'] ?? null,
            'valid' => $valid,
            'errors' => $fetchError !== null ? array_values(array_unique([...$errors, $fetchError])) : $errors,
            'old_reduction_percent' => $d['reduction_percent'] ?? null,
            'old_from' => $d['reduction_from'] ?? null,
            'old_to' => $d['reduction_to'] ?? null,
            'new_reduction_percent' => $reduction,
            'from' => $from,
            'to' => $to,
            'sell_price_with_vat_before' => $vatBefore,
            'sell_price_with_vat_after' => $vatAfter,
            'margin_percent_after' => $marginEval['margin_percent'],
            'margin_blocked' => $marginEval['blocked'],
            'margin_unknown' => $marginEval['unknown'],
            'conflict' => $conflict,
            'inactive' => $inactive,
            'qty_zero' => $qtyZero,
            // Blokované pre reálny zápis, kým sa nevyrieši (override marže / oprava).
            'blocked' => $marginEval['blocked'] || ! $valid,
        ];
    }
}
