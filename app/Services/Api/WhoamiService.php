<?php

declare(strict_types=1);

namespace App\Services\Api;

use Carbon\CarbonImmutable;

/**
 * Introspekcia kľúča a fail-closed rozhodovanie pred zápisom.
 */
final class WhoamiService
{
    /** Scopes, ktoré appka potrebuje na plnú funkčnosť. */
    public const REQUIRED_SCOPES = ['product:edit', 'product:read', 'orders:read'];

    public function __construct(private readonly SperkyClient $client) {}

    /**
     * @return array{
     *   connected: bool,
     *   scopes: list<string>,
     *   missing: list<string>,
     *   expires_at: ?string,
     *   remaining: array<string,mixed>,
     *   error: ?string
     * }
     */
    public function check(): array
    {
        $r = $this->client->whoami();

        if (! $r->success) {
            return [
                'connected' => false,
                'scopes' => [],
                'missing' => self::REQUIRED_SCOPES,
                'expires_at' => null,
                'remaining' => [],
                'error' => $r->firstError() ?? 'unreachable',
            ];
        }

        $scopes = array_values(array_filter((array) ($r->data['scopes'] ?? []), 'is_string'));

        return [
            'connected' => true,
            'scopes' => $scopes,
            'missing' => array_values(array_diff(self::REQUIRED_SCOPES, $scopes)),
            'expires_at' => $r->data['expires_at'] ?? null,
            'remaining' => (array) ($r->data['remaining'] ?? []),
            'error' => null,
        ];
    }

    public function hasScope(string $scope): bool
    {
        return in_array($scope, $this->check()['scopes'], true);
    }

    /** Vypršal by kľúč pred daným časom behu kampane? */
    public function expiresBefore(CarbonImmutable $runAt): bool
    {
        $exp = $this->check()['expires_at'];
        if ($exp === null) {
            return false; // bez expiry (rieši 48 h pripomienka z key_set_at)
        }

        return CarbonImmutable::parse($exp)->lessThan($runAt);
    }

    /** Zápis povolený len ak sme pripojení a máme product:edit. */
    public function canWrite(): bool
    {
        $s = $this->check();

        return $s['connected'] && in_array('product:edit', $s['scopes'], true);
    }
}
