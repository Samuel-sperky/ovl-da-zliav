<?php

declare(strict_types=1);

namespace App\Services\I18n;

/**
 * Preklad chybových kódov API na SK vetu + odporúčanú akciu. Neznámy kód sa zaloguje.
 */
final class ErrorTranslator
{
    /**
     * @return array{code:string, message:string, action:string}
     */
    public function translate(string $code): array
    {
        $map = (array) trans('errors', [], 'sk');
        $entry = $map[$code] ?? null;

        if (! is_array($entry)) {
            // Neznámy kód — bezpečný fallback + záznam do logu (bez PII).
            logger()->warning('Neznámy API error kód', ['code' => $code]);
            $entry = $map['unknown_error'];
        }

        return [
            'code' => $code,
            'message' => $entry['message'],
            'action' => $entry['action'],
        ];
    }

    /**
     * @param  list<string>  $codes
     * @return list<array{code:string, message:string, action:string}>
     */
    public function translateMany(array $codes): array
    {
        return array_map(fn (string $c) => $this->translate($c), array_values(array_unique($codes)));
    }

    public function short(string $code): string
    {
        return $this->translate($code)['message'];
    }
}
