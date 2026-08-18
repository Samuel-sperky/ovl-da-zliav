<?php

declare(strict_types=1);

namespace App\Services\Batch;

/**
 * Ochrana marže. Počíta maржu po percentuálnej zľave z getFull polí
 * (sell_price = cena bez DPH, purchase_price = nákup). Pod prahom = tvrdý blok,
 * prejsť len explicitným override s dôvodom.
 */
final class MarginGuard
{
    public function minPercent(): float
    {
        return (float) config('sperky.guards.min_margin_percent', 15);
    }

    /**
     * Marža po zľave v %. null ak chýba purchase_price/sell_price (nevieme spočítať).
     */
    public function postReductionMarginPercent(?float $sellPrice, ?float $purchasePrice, float $reductionPercent): ?float
    {
        if ($sellPrice === null || $purchasePrice === null || $sellPrice <= 0) {
            return null;
        }
        $discounted = $sellPrice * (1 - $reductionPercent / 100);
        if ($discounted <= 0) {
            return -100.0;
        }

        return round((($discounted - $purchasePrice) / $discounted) * 100, 2);
    }

    /**
     * @param  array<string,mixed>  $getFull
     * @return array{margin_percent:?float, blocked:bool, unknown:bool}
     */
    public function evaluate(array $getFull, float $reductionPercent): array
    {
        $sell = isset($getFull['sell_price']) ? (float) $getFull['sell_price'] : null;
        $purchase = isset($getFull['purchase_price']) ? (float) $getFull['purchase_price'] : null;

        $margin = $this->postReductionMarginPercent($sell, $purchase, $reductionPercent);

        if ($margin === null) {
            // Nevieme spočítať → nebllokujeme tvrdo, ale označíme ako neznáme (varovanie v UI).
            return ['margin_percent' => null, 'blocked' => false, 'unknown' => true];
        }

        return [
            'margin_percent' => $margin,
            'blocked' => $margin < $this->minPercent(),
            'unknown' => false,
        ];
    }
}
