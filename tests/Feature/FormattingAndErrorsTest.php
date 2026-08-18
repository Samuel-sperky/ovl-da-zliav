<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\I18n\ErrorTranslator;
use App\Support\Format;
use Tests\TestCase;

class FormattingAndErrorsTest extends TestCase
{
    public function test_money_sk_format(): void
    {
        $this->assertSame("19,99\u{00A0}€", Format::money(19.99));
        $this->assertSame("19,99\u{00A0}€ s DPH", Format::money(19.99, withVatLabel: true));
        $this->assertSame('—', Format::money(null));
    }

    public function test_percent_sk_format(): void
    {
        $this->assertSame("-15\u{00A0}%", Format::percent(15, asDiscount: true));
        $this->assertSame("15\u{00A0}%", Format::percent(15));
        $this->assertSame("12,5\u{00A0}%", Format::percent(12.5));
    }

    public function test_date_sk_format(): void
    {
        $this->assertSame('18.08.2026', Format::date('2026-08-18'));
        $this->assertSame('18.08.2026 – 18.09.2026', Format::dateRange('2026-08-18', '2026-09-18'));
    }

    public function test_error_translation_sk(): void
    {
        $t = app(ErrorTranslator::class);
        $flash = $t->translate('blocked_by_flash_sale');
        $this->assertStringContainsString('flash sale', $flash['message']);
        $this->assertNotEmpty($flash['action']);

        // neznámy kód → bezpečný fallback
        $unknown = $t->translate('totalne_nieco_ine');
        $this->assertSame('totalne_nieco_ine', $unknown['code']);
        $this->assertNotEmpty($unknown['message']);
    }
}
