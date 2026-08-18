<?php

declare(strict_types=1);

/*
 * Preklad API/aplikačných chybových kódov na zrozumiteľnú SK vetu + odporúčaný krok.
 * Zdieľané UI, notifikáciami aj auditom (cez ErrorTranslator).
 */
return [
    'blocked_by_flash_sale' => [
        'message' => 'Na produkte beží flash sale (TurboSaleUltimate).',
        'action' => 'Položka bola preskočená — skús ju neskôr, po skončení flash sale.',
    ],
    'range_too_long' => [
        'message' => 'Okno zľavy je dlhšie ako 3 mesiace.',
        'action' => 'Skráť dátum „do" tak, aby okno nepresiahlo 3 mesiace.',
    ],
    'invalid_reduction' => [
        'message' => 'Neplatná výška zľavy.',
        'action' => 'Zadaj percento v rozsahu 0 – 30 % (krok 0,5). Na zrušenie zľavy použi „Zrušiť zľavu".',
    ],
    'invalid_dates' => [
        'message' => 'Neplatné dátumy okna.',
        'action' => 'Skontroluj, že „do" nie je pred „od" a formát je platný.',
    ],
    'invalid_input' => [
        'message' => 'Neplatný vstup.',
        'action' => 'Skontroluj zadané hodnoty a skús znova.',
    ],
    'forbidden' => [
        'message' => 'Prístup odmietnutý — kľúč chýba alebo nemá potrebný scope.',
        'action' => 'Skontroluj API kľúč a jeho oprávnenia (whoami). Zápis vyžaduje product:edit.',
    ],
    'not_found' => [
        'message' => 'Produkt sa nenašiel.',
        'action' => 'Over ID produktu.',
    ],
    'method_not_allowed' => [
        'message' => 'Nesprávna HTTP metóda.',
        'action' => 'Interná chyba požiadavky — nahlás to.',
    ],
    'rate_limited' => [
        'message' => 'Prekročený rate-limit API.',
        'action' => 'Appka automaticky spomalí a skúsi znova. Počkaj chvíľu.',
    ],
    'batch_not_allowed' => [
        'message' => 'Dávkové čítanie nie je pre tento endpoint povolené.',
        'action' => 'Appka prejde na sekvenčné čítanie automaticky.',
    ],
    'request_failed' => [
        'message' => 'Chyba na strane servera eshopu (5xx).',
        'action' => 'Appka to skúsi znova; ak pretrváva, skús neskôr.',
    ],
    'connection_failed' => [
        'message' => 'Nepodarilo sa spojiť s API eshopu.',
        'action' => 'Skontroluj sieť a dostupnosť eshopu.',
    ],
    'unknown_controller' => [
        'message' => 'Neznámy endpoint API.',
        'action' => 'Interná chyba — nahlás to.',
    ],
    'verify_read_failed' => [
        'message' => 'Zápis prešiel, ale nepodarilo sa overiť skutočný stav.',
        'action' => 'Stav je označený ako neistý — reconciliation ho preverí.',
    ],
    'kill_switch' => [
        'message' => 'Kill-switch je zapnutý — reálne zápisy sú zablokované.',
        'action' => 'Vypni kill-switch v nastaveniach, ak chceš zapisovať.',
    ],
    'unknown_error' => [
        'message' => 'Neznáma chyba.',
        'action' => 'Skús znova; ak pretrváva, pozri audit/log.',
    ],
];
