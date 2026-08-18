<?php

declare(strict_types=1);

// UI reťazce (SK). Držané tu, nie natvrdo v Blade.
return [
    'name' => 'Aura Zľavy',
    'production_badge' => 'PRODUKCIA',

    'nav' => [
        'dashboard' => 'Prehľad',
        'products' => 'Produkty',
        'campaigns' => 'Kampane',
        'recommendations' => 'Návrhy zliav',
        'audit' => 'Audit',
        'settings' => 'Nastavenia',
        'logout' => 'Odhlásiť',
    ],

    'dashboard' => [
        'active' => 'Aktívne zľavy',
        'expiring' => 'Expirujúce dnes/zajtra',
        'scheduled' => 'Naplánované kampane',
        'key_status' => 'Stav API kľúča',
        'rate_budget' => 'Zostatok rate-limitu',
        'empty' => 'Zatiaľ nič — začni vyhľadaním produktu.',
    ],

    'actions' => [
        'search' => 'Vyhľadať',
        'preview' => 'Zobraziť náhľad (dry-run)',
        'write' => 'Zapísať naostro (:count)',
        'confirm' => 'Potvrdiť',
        'cancel' => 'Zrušiť',
        'clear_discount' => 'Zrušiť zľavu',
        'extend' => 'Predĺžiť „do"',
        'repeat' => 'Zopakovať',
        'stop' => 'Zastaviť dávku',
        'kill_switch' => 'Núdzová stopka (kill-switch)',
        'clear_all' => 'Zrušiť všetky nasadené zľavy',
    ],

    'dry_run' => [
        'title' => 'Náhľad zmien (dry-run)',
        'old' => 'Pôvodná zľava',
        'new' => 'Nová zľava',
        'window' => 'Okno',
        'price_with_vat' => 'Cena s DPH',
        'margin_after' => 'Marža po zľave',
        'summary' => 'Spolu :total · pod prahom marže :blocked · konflikty :conflicts',
        'confirm_hint' => 'Prepíš počet :count alebo slovo „:word" pre potvrdenie reálneho zápisu.',
    ],

    'flags' => [
        'low_margin' => 'Nízka marža',
        'conflict' => 'Prepisuje existujúcu zľavu',
        'inactive' => 'Neaktívny produkt',
        'qty_zero' => 'Vypredané',
        'margin_unknown' => 'Marža neznáma',
    ],

    'states' => [
        'pending' => 'Čaká',
        'dry_run_ok' => 'Náhľad OK',
        'awaiting_confirm' => 'Čaká na potvrdenie',
        'queued' => 'Vo fronte',
        'sent' => 'Odoslané',
        'verified' => 'Overené',
        'failed' => 'Zlyhalo',
        'compensated' => 'Kompenzované',
        'skipped_flash_sale' => 'Preskočené (flash sale)',
        'skipped_low_margin' => 'Preskočené (nízka marža)',
        'uncertain' => 'Neisté',
    ],

    'key' => [
        'set_on' => 'Kľúč nastavený :date',
        'rotate_soon' => 'Odporúčaná rotácia kľúča (48 h).',
        'expires' => 'Platnosť do :date',
        'masked' => '•••• :last4',
    ],
];
