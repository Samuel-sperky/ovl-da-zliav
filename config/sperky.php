<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Konfigurácia Aura Zľavy (SPERKY API + prevádzkové poistky)
|--------------------------------------------------------------------------
| Hodnoty tu sú .env fallback. Runtime hodnoty (editovateľné v UI) drží
| tabuľka `settings` (P2) — služba Settings ich číta s fallbackom sem.
*/

return [

    // ── SPERKY API ──────────────────────────────────────────────
    'api' => [
        'base_url' => rtrim((string) env('SPERKY_BASE_URL', 'https://sperky-eshop.sk'), '/'),
        'key' => env('SPERKY_API_KEY'),
        'timeout_connect' => (int) env('SPERKY_TIMEOUT_CONNECT', 5),
        'timeout_request' => (int) env('SPERKY_TIMEOUT_REQUEST', 15),
        'max_retries' => (int) env('SPERKY_MAX_RETRIES', 3),
        // Konzervatívny strop položiek na jedno /api/batch volanie
        // (kontrakt max. neuvádza → degradácia na sekvenčné pri chybe).
        'batch_chunk' => (int) env('SPERKY_BATCH_CHUNK', 20),
    ],

    // Časové pásmo eshopu — okná zliav a "dnes" sa počítajú v ňom.
    'shop_timezone' => env('SHOP_TIMEZONE', 'Europe/Bratislava'),

    // ── Kontraktné limity (fixné, dané API dokumentom) ──────────
    'limits' => [
        'reduction_min' => 0.0,   // exkluzívne: 0 < x
        'reduction_max' => 30.0,  // inkluzívne
        'reduction_step' => 0.5,
        'window_max_months' => 3,
    ],

    // ── Prevádzkové poistky (default; UI ich prepíše cez settings) ─
    'guards' => [
        'batch_cap' => (int) env('OVL_BATCH_CAP', 200),
        'daily_cap' => (int) env('OVL_DAILY_CAP', 500),
        'min_margin_percent' => (float) env('OVL_MIN_MARGIN_PERCENT', 15),
        'confirm_threshold' => (int) env('OVL_CONFIRM_THRESHOLD', 50),
        'confirm_word' => env('OVL_CONFIRM_WORD', 'POTVRDZUJEM'),
        'rate_reserve_per_min' => (int) env('OVL_RATE_RESERVE_PER_MIN', 10),
        'drift_tolerance_percent' => (float) env('OVL_DRIFT_TOLERANCE_PERCENT', 1),
        'kill_switch' => filter_var(env('OVL_KILL_SWITCH', false), FILTER_VALIDATE_BOOL),
    ],

    // ── GDPR / retencia ─────────────────────────────────────────
    'retention' => [
        // Agregáty z objednávok a snapshoty: rolujúca TTL (dni). Audit = natrvalo.
        'aggregates_days' => (int) env('OVL_RETENTION_DAYS', 90),
        'snapshots_days' => (int) env('OVL_RETENTION_DAYS', 90),
    ],

    // ── Bezpečnosť lokálneho behu ───────────────────────────────
    'security' => [
        // Povolené Host hlavičky (obrana proti DNS-rebinding).
        'allowed_hosts' => array_filter(array_map('trim', explode(',', (string) env(
            'OVL_ALLOWED_HOSTS',
            '127.0.0.1:3050,localhost:3050,127.0.0.1,localhost'
        )))),
        'operator_password_hash' => env('OPERATOR_PASSWORD_HASH'),
        // Re-auth pred reálnym zápisom platí X minút.
        'reauth_ttl_minutes' => (int) env('OVL_REAUTH_TTL_MINUTES', 10),
        'idle_lock_minutes' => (int) env('OVL_IDLE_LOCK_MINUTES', 20),
    ],

    // Rotácia kľúča: pripomienka po 48 h od key_set_at (ak whoami.expires_at je null).
    'key_rotation_hours' => (int) env('OVL_KEY_ROTATION_HOURS', 48),
];
