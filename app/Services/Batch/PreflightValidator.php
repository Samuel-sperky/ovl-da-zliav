<?php

declare(strict_types=1);

namespace App\Services\Batch;

use Carbon\CarbonImmutable;

/**
 * Lokálna tvrdá validácia pred akýmkoľvek volaním API (šetrí rate budget,
 * zabráni polovičným dávkam padajúcim na invalid_reduction/range_too_long).
 */
final class PreflightValidator
{
    /**
     * @return list<string>  prázdne = OK; inak kódy: invalid_reduction | invalid_dates | range_too_long
     */
    public function validate(float $reduction, string $from, string $to): array
    {
        $errors = [];

        $min = (float) config('sperky.limits.reduction_min', 0);
        $max = (float) config('sperky.limits.reduction_max', 30);
        $step = (float) config('sperky.limits.reduction_step', 0.5);

        // 0 < reduction <= 30 (pre 0 sa používa clearReduction)
        if ($reduction <= $min || $reduction > $max) {
            $errors[] = 'invalid_reduction';
        } elseif ($step > 0 && abs(fmod($reduction, $step)) > 1e-9) {
            $errors[] = 'invalid_reduction';
        }

        $f = $this->parse($from);
        $t = $this->parse($to);

        if ($f === null || $t === null) {
            $errors[] = 'invalid_dates';

            return array_values(array_unique($errors));
        }

        if ($t->lessThan($f)) {
            $errors[] = 'invalid_dates';
        }

        $maxMonths = (int) config('sperky.limits.window_max_months', 3);
        if ($t->greaterThan($f->addMonths($maxMonths))) {
            $errors[] = 'range_too_long';
        }

        return array_values(array_unique($errors));
    }

    public function isValid(float $reduction, string $from, string $to): bool
    {
        return $this->validate($reduction, $from, $to) === [];
    }

    private function parse(string $date): ?CarbonImmutable
    {
        // Prísny formát YYYY-MM-DD
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return null;
        }
        try {
            return CarbonImmutable::createFromFormat('!Y-m-d', $date) ?: null;
        } catch (\Throwable) {
            return null;
        }
    }
}
