<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\Batch\MarginGuard;
use Tests\TestCase;

class MarginGuardTest extends TestCase
{
    private MarginGuard $g;

    protected function setUp(): void
    {
        parent::setUp();
        $this->g = new MarginGuard;
    }

    public function test_healthy_margin_not_blocked(): void
    {
        // sell 10, purchase 6, -15% → discounted 8.5, margin (8.5-6)/8.5 = 29.41 %
        $r = $this->g->evaluate(['sell_price' => 10, 'purchase_price' => 6], 15);
        $this->assertFalse($r['blocked']);
        $this->assertEqualsWithDelta(29.41, $r['margin_percent'], 0.05);
    }

    public function test_loss_making_is_blocked(): void
    {
        // sell 10, purchase 9.5, -30% → discounted 7, margin (7-9.5)/7 < 0
        $r = $this->g->evaluate(['sell_price' => 10, 'purchase_price' => 9.5], 30);
        $this->assertTrue($r['blocked']);
        $this->assertLessThan(15, $r['margin_percent']);
    }

    public function test_unknown_when_purchase_missing(): void
    {
        $r = $this->g->evaluate(['sell_price' => 10], 15);
        $this->assertTrue($r['unknown']);
        $this->assertFalse($r['blocked']);
        $this->assertNull($r['margin_percent']);
    }
}
