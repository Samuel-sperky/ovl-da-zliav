<?php

declare(strict_types=1);

namespace App\Support;

use Carbon\CarbonInterface;

/**
 * Slovenské formátovanie: peniaze (19,99 €), percentá (-15 %), dátumy (DD.MM.YYYY).
 * Bez závislosti na intl — deterministické pre SK konvenciu.
 */
final class Format
{
    public static function money(int|float|string|null $value, bool $withVatLabel = false): string
    {
        if ($value === null) {
            return '—';
        }
        $s = number_format((float) $value, 2, ',', "\u{00A0}")."\u{00A0}€";

        return $withVatLabel ? $s.' s DPH' : $s;
    }

    /** Percento zľavy, napr. -15 % alebo 15 %. */
    public static function percent(int|float|string|null $value, bool $asDiscount = false): string
    {
        if ($value === null) {
            return '—';
        }
        $v = (float) $value;
        $num = rtrim(rtrim(number_format($v, 1, ',', ''), '0'), ',');
        $prefix = $asDiscount && $v > 0 ? '-' : '';

        return $prefix.$num."\u{00A0}%";
    }

    public static function date(CarbonInterface|string|null $date): string
    {
        if ($date === null || $date === '') {
            return '—';
        }
        $c = $date instanceof CarbonInterface ? $date : \Carbon\CarbonImmutable::parse($date);

        return $c->format('d.m.Y');
    }

    public static function dateRange(CarbonInterface|string|null $from, CarbonInterface|string|null $to): string
    {
        return self::date($from).' – '.self::date($to);
    }
}
