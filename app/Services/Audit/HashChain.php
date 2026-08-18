<?php

declare(strict_types=1);

namespace App\Services\Audit;

/**
 * Hash-reťaz auditu (tamper-evidencia). hash_self = sha256(hash_prev || kanonické pole).
 */
final class HashChain
{
    /**
     * @param  array<string,mixed>  $payload  polia záznamu (bez hash_self)
     */
    public function compute(?string $hashPrev, array $payload): string
    {
        ksort($payload);
        $canonical = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return hash('sha256', ($hashPrev ?? '').'|'.$canonical);
    }
}
