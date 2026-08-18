<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\Api\RateBudget;
use App\Services\Api\SperkyClient;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SperkyClientTest extends TestCase
{
    private function client(): SperkyClient
    {
        return app(SperkyClient::class);
    }

    public function test_whoami_success_updates_rate_budget(): void
    {
        Http::fake([
            '*/api/whoami' => Http::response([
                'result' => [
                    'ok' => true,
                    'scopes' => ['product:edit', 'product:read', 'orders:read'],
                    'expires_at' => null,
                    'remaining' => ['per_minute' => 59, 'per_day' => 9987],
                ],
            ], 200),
        ]);

        $r = $this->client()->whoami();

        $this->assertTrue($r->success);
        $this->assertSame(59, app(RateBudget::class)->remainingPerMinute());
        $this->assertSame(9987, app(RateBudget::class)->remainingPerDay());
    }

    public function test_get_full_success(): void
    {
        Http::fake([
            '*/api/products/getFull*' => Http::response([
                'result' => ['ok' => true, 'id' => 49, 'reduction_percent' => null, 'margin_percent' => 42.5],
            ], 200),
        ]);

        $r = $this->client()->getFull(49);

        $this->assertTrue($r->success);
        $this->assertSame(49, $r->data['id']);
    }

    public function test_set_reduction_flash_sale_conflict_not_retried(): void
    {
        Http::fake([
            '*/api/products/setReduction' => Http::response(['ok' => false, 'errors' => ['blocked_by_flash_sale']], 409),
        ]);

        $r = $this->client()->setReduction(49, '2026-08-18', '2026-08-30', 15);

        $this->assertFalse($r->success);
        $this->assertTrue($r->isFlashSaleBlocked());
        Http::assertSentCount(1); // 409 sa neretryuje
    }

    public function test_set_reduction_success(): void
    {
        Http::fake([
            '*/api/products/setReduction' => Http::response(['result' => ['ok' => true, 'id' => 49]], 200),
        ]);

        $r = $this->client()->setReduction(49, '2026-08-18', '2026-08-30', 15);

        $this->assertTrue($r->success);
        $this->assertSame(49, $r->data['id']);
    }

    public function test_forbidden_is_not_retried(): void
    {
        Http::fake([
            '*/api/products/getFull*' => Http::response(['error' => 'forbidden'], 403),
        ]);

        $r = $this->client()->getFull(49);

        $this->assertFalse($r->success);
        $this->assertTrue($r->isForbidden());
        Http::assertSentCount(1);
    }
}
