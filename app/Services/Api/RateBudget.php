<?php

declare(strict_types=1);

namespace App\Services\Api;

use Illuminate\Support\Facades\Cache;

/**
 * Sleduje zostávajúci rate-limit z whoami.remaining (per_minute aj per_day)
 * a drží rezervu, aby dávka nevyhladovala čítania/whoami. Kontrakt konkrétny
 * strop neuvádza — zdroj pravdy je whoami.
 */
final class RateBudget
{
    private const KEY = 'sperky:rate_budget';

    public function __construct(
        private readonly int $reservePerMinute = 10,
    ) {}

    /** Aktualizuj zo živého whoami.remaining. */
    public function update(?int $perMinute, ?int $perDay): void
    {
        Cache::put(self::KEY, [
            'per_minute' => $perMinute,
            'per_day' => $perDay,
            'at' => now()->timestamp,
        ], now()->addMinutes(5));
    }

    public function remainingPerMinute(): ?int
    {
        return Cache::get(self::KEY)['per_minute'] ?? null;
    }

    public function remainingPerDay(): ?int
    {
        return Cache::get(self::KEY)['per_day'] ?? null;
    }

    /**
     * Máme rozpočet na ďalší zápisový request? Rešpektuje rezervu na minútu
     * a nulový denný zostatok. Ak whoami zatiaľ nebolo, dovolíme (client si ho
     * pýta pri štarte/pred dávkou a fail-closed rieši 403/429 zvlášť).
     */
    public function canProceed(): bool
    {
        $data = Cache::get(self::KEY);
        if ($data === null) {
            return true;
        }
        if ($data['per_day'] !== null && $data['per_day'] <= 0) {
            return false;
        }
        if ($data['per_minute'] !== null && $data['per_minute'] <= $this->reservePerMinute) {
            return false;
        }

        return true;
    }

    /** Lokálne zníženie po úspešnom volaní (medzi whoami obnovami). */
    public function decrement(): void
    {
        $data = Cache::get(self::KEY);
        if ($data === null) {
            return;
        }
        if ($data['per_minute'] !== null) {
            $data['per_minute'] = max(0, $data['per_minute'] - 1);
        }
        if ($data['per_day'] !== null) {
            $data['per_day'] = max(0, $data['per_day'] - 1);
        }
        Cache::put(self::KEY, $data, now()->addMinutes(5));
    }
}
