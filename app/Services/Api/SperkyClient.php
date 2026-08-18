<?php

declare(strict_types=1);

namespace App\Services\Api;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;

/**
 * Klient SPERKY API. Každá metóda vracia NormalizedResponse.
 * Retry len na 429/5xx a spojenie; 4xx (403/404/409/…) sa neretryuje.
 * API kľúč sa NIKDY nedostane do logov ani do uložených odpovedí.
 */
final class SperkyClient
{
    public function __construct(
        private readonly ResponseNormalizer $normalizer,
        private readonly RateBudget $budget,
    ) {}

    // ── Čítanie ──────────────────────────────────────────────

    public function whoami(): NormalizedResponse
    {
        $r = $this->send('get', '/api/whoami');
        if ($r->success) {
            $rem = $r->data['remaining'] ?? [];
            $this->budget->update(
                isset($rem['per_minute']) ? (int) $rem['per_minute'] : null,
                array_key_exists('per_day', $rem) ? ($rem['per_day'] === null ? null : (int) $rem['per_day']) : null,
            );
        }

        return $r;
    }

    public function products(int $page = 1, int $perPage = 50, ?int $idLang = null): NormalizedResponse
    {
        return $this->send('get', '/api/products', array_filter([
            'page' => $page, 'per_page' => $perPage, 'id_lang' => $idLang,
        ], fn ($v) => $v !== null));
    }

    public function productGet(int $id, ?int $idLang = null): NormalizedResponse
    {
        return $this->send('get', '/api/products/get', array_filter([
            'id' => $id, 'id_lang' => $idLang,
        ], fn ($v) => $v !== null));
    }

    /** Fuzzy Meili vyhľadávanie (verejné). Vracia len id[]. */
    public function searchIndex(array $params): NormalizedResponse
    {
        return $this->send('get', '/api/products/searchIndex', $params);
    }

    /** Filtrovaný/sortovaný výber (product:read). Vracia len id[]. */
    public function search(array $params): NormalizedResponse
    {
        return $this->send('get', '/api/products/search', $params);
    }

    /** Zdroj pravdy o produkte (product:read). */
    public function getFull(int $id, ?int $idLang = null): NormalizedResponse
    {
        return $this->send('get', '/api/products/getFull', array_filter([
            'id' => $id, 'id_lang' => $idLang,
        ], fn ($v) => $v !== null));
    }

    /**
     * Dávkové čítanie getFull. Kontrakt uvádza možnosť batchovať getFull cez
     * /api/batch, ale nešpecifikuje presný tvar payloadu — preto zatiaľ
     * sekvenčne (korektné, len pomalšie); optimalizácia keď bude tvar batchu známy.
     *
     * @param  list<int>  $ids
     * @return array<int,NormalizedResponse>  kľúčované product id
     */
    public function getFullBatch(array $ids, ?int $idLang = null): array
    {
        $out = [];
        foreach ($ids as $id) {
            $out[$id] = $this->getFull($id, $idLang);
        }

        return $out;
    }

    public function categories(?int $idLang = null): NormalizedResponse
    {
        return $this->send('get', '/api/categories', array_filter([
            'id_lang' => $idLang,
        ], fn ($v) => $v !== null));
    }

    public function orders(array $params = []): NormalizedResponse
    {
        return $this->send('get', '/api/order', $params);
    }

    public function orderGet(int $id): NormalizedResponse
    {
        return $this->send('get', '/api/order/get', ['id' => $id]);
    }

    // ── Zápis (product:edit) ─────────────────────────────────

    public function setReduction(int $id, string $from, string $to, float $reduction): NormalizedResponse
    {
        return $this->send('post', '/api/products/setReduction', [
            'id' => $id, 'from' => $from, 'to' => $to, 'reduction' => $reduction,
        ], form: true);
    }

    public function clearReduction(int $id): NormalizedResponse
    {
        return $this->send('post', '/api/products/clearReduction', ['id' => $id], form: true);
    }

    // ── Interné ──────────────────────────────────────────────

    private function base(): PendingRequest
    {
        $cfg = config('sperky.api');
        $req = Http::baseUrl($cfg['base_url'])
            ->connectTimeout((int) $cfg['timeout_connect'])
            ->timeout((int) $cfg['timeout_request'])
            ->acceptJson();

        if (! empty($cfg['key'])) {
            $req = $req->withHeaders(['X-Api-Key' => $cfg['key']]);
        }

        return $req;
    }

    /**
     * @param  array<string,mixed>  $params
     */
    private function send(string $method, string $path, array $params = [], bool $form = false): NormalizedResponse
    {
        $maxRetries = (int) config('sperky.api.max_retries', 3);
        $attempt = 0;

        while (true) {
            $attempt++;
            try {
                $req = $this->base();
                if ($method === 'get') {
                    $resp = $req->get($path, $params);
                } else {
                    $resp = $form ? $req->asForm()->post($path, $params) : $req->post($path, $params);
                }
            } catch (ConnectionException $e) {
                if ($attempt <= $maxRetries) {
                    $this->backoff($attempt);

                    continue;
                }

                return new NormalizedResponse(false, [], ['connection_failed'], 0);
            }

            $status = $resp->status();

            if (($status === 429 || $status >= 500) && $attempt <= $maxRetries) {
                $retryAfter = (int) ($resp->header('Retry-After') ?: 0);
                $this->backoff($attempt, $retryAfter);

                continue;
            }

            $body = $resp->json();
            $normalized = $this->normalizer->normalize(is_array($body) ? $body : null, $status);

            if ($normalized->success) {
                $this->budget->decrement();
            }

            return $normalized;
        }
    }

    private function backoff(int $attempt, int $retryAfterSeconds = 0): void
    {
        $ms = $retryAfterSeconds > 0
            ? $retryAfterSeconds * 1000
            : (int) (250 * (2 ** ($attempt - 1)));
        // Strop, aby sme nespali priveľmi vo worker procese.
        usleep(min($ms, 10_000) * 1000);
    }
}
