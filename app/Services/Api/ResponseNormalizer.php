<?php

declare(strict_types=1);

namespace App\Services\Api;

/**
 * Zjednocuje všetky tvary odpovede SPERKY API na NormalizedResponse.
 *
 * Pokrýva:
 *  - úspech zabalený v {"result": {...}}
 *  - chyby bez obalu: {"error":"forbidden"}, {"ok":false,"errors":[...]}
 *  - HTTP 200 + ok:false + singulárny error (napr. order/get)
 *  - odvodenie kódu z HTTP statusu, keď telo kód nenesie
 */
final class ResponseNormalizer
{
    /**
     * @param  array<string,mixed>|null  $body  dekódované JSON telo
     */
    public function normalize(?array $body, int $status): NormalizedResponse
    {
        $body ??= [];

        // Rozbaliť `result` obal, ak je prítomný; inak čítať top-level.
        $inner = (isset($body['result']) && is_array($body['result'])) ? $body['result'] : $body;

        $errorCodes = [];
        foreach ([$body, $inner] as $scope) {
            if (isset($scope['error']) && is_string($scope['error'])) {
                $errorCodes[] = $scope['error'];
            }
            if (isset($scope['errors']) && is_array($scope['errors'])) {
                foreach ($scope['errors'] as $e) {
                    if (is_string($e)) {
                        $errorCodes[] = $e;
                    }
                }
            }
        }

        // Príznak ok (inner má prednosť pred top-level).
        $okFlag = null;
        if (array_key_exists('ok', $inner)) {
            $okFlag = (bool) $inner['ok'];
        } elseif (array_key_exists('ok', $body)) {
            $okFlag = (bool) $body['ok'];
        }

        if ($okFlag !== null) {
            $success = $okFlag && $errorCodes === [];
        } else {
            $success = $status >= 200 && $status < 300 && $errorCodes === [];
        }

        // Ak nie je úspech a telo nedalo kód, odvodiť z HTTP statusu.
        if (! $success && $errorCodes === []) {
            $errorCodes[] = match (true) {
                $status === 400 => 'invalid_input',
                $status === 403 => 'forbidden',
                $status === 404 => 'not_found',
                $status === 405 => 'method_not_allowed',
                $status === 409 => 'blocked_by_flash_sale',
                $status === 429 => 'rate_limited',
                $status >= 500 => 'request_failed',
                default => 'unknown_error',
            };
        }

        /** @var array<string,mixed> $data */
        $data = is_array($inner) ? $inner : [];

        return new NormalizedResponse(
            success: $success,
            data: $data,
            errorCodes: array_values(array_unique($errorCodes)),
            httpStatus: $status,
        );
    }
}
