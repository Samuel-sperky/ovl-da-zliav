<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Enums\ItemState;
use App\Models\Snapshot;
use App\Services\Batch\BatchRunner;
use App\Services\Batch\DryRunService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class BatchEngineTest extends TestCase
{
    use RefreshDatabase;

    private function fakeWhoami(): array
    {
        return ['result' => [
            'ok' => true,
            'scopes' => ['product:edit', 'product:read', 'orders:read'],
            'expires_at' => null,
            'remaining' => ['per_minute' => 100, 'per_day' => 1000],
        ]];
    }

    public function test_dry_run_flags_conflict_and_margin(): void
    {
        Http::fake([
            '*/api/products/getFull*' => Http::response(['result' => [
                'ok' => true, 'id' => 49, 'name' => 'Náramok',
                'reduction_percent' => 10, 'reduction_from' => '2026-08-01', 'reduction_to' => '2026-08-20',
                'sell_price' => 10, 'purchase_price' => 9.5, 'sell_price_with_vat' => 12,
                'active' => true, 'qty' => 3,
            ]], 200),
        ]);

        $res = app(DryRunService::class)->run(
            [['product_id' => 49, 'reduction' => 30]],
            '2026-08-18', '2026-09-18'
        );

        $row = $res['rows'][0];
        $this->assertTrue($row['conflict']);          // existujúca zľava 10 %
        $this->assertTrue($row['margin_blocked']);    // 30 % pošle maржu pod 15 %
        $this->assertSame(1, $res['summary']['conflicts']);
        $this->assertSame(1, $res['summary']['blocked']);
    }

    public function test_real_write_flow_verifies_and_audits(): void
    {
        $getFull = 0;
        Http::fake(function ($request) use (&$getFull) {
            $url = $request->url();
            if (str_contains($url, '/api/whoami')) {
                return Http::response($this->fakeWhoami(), 200);
            }
            if (str_contains($url, '/api/products/getFull')) {
                $getFull++;
                $reduction = $getFull === 1 ? null : 15;
                return Http::response(['result' => [
                    'ok' => true, 'id' => 49, 'name' => 'Náramok',
                    'reduction_percent' => $reduction,
                    'reduction_from' => $reduction ? '2026-08-18' : null,
                    'reduction_to' => $reduction ? '2026-09-18' : null,
                    'sell_price' => 10, 'purchase_price' => 6, 'sell_price_with_vat' => 12,
                    'active' => true, 'qty' => 5,
                ]], 200);
            }
            if (str_contains($url, '/api/products/setReduction')) {
                return Http::response(['result' => ['ok' => true, 'id' => 49]], 200);
            }

            return Http::response(['error' => 'unknown_controller'], 400);
        });

        $runner = app(BatchRunner::class);
        $op = $runner->createBatch([['product_id' => 49, 'reduction' => 15]], '2026-08-18', '2026-09-18', 'set', 'manual', 'operator');
        $runner->confirmAndRun($op); // sync queue → beží hneď

        $item = $op->items()->first();
        $this->assertSame(ItemState::Verified, $item->state);
        $this->assertSame(2, Snapshot::where('product_id', 49)->count()); // before + after
        $this->assertDatabaseHas('audit_log', ['product_id' => 49, 'result' => 'ok', 'action' => 'set']);
    }

    public function test_flash_sale_is_skipped_not_failed(): void
    {
        Http::fake(function ($request) {
            $url = $request->url();
            if (str_contains($url, '/api/whoami')) {
                return Http::response($this->fakeWhoami(), 200);
            }
            if (str_contains($url, '/api/products/getFull')) {
                return Http::response(['result' => ['ok' => true, 'id' => 49, 'reduction_percent' => null, 'sell_price' => 10, 'purchase_price' => 6, 'sell_price_with_vat' => 12, 'active' => true, 'qty' => 5]], 200);
            }
            if (str_contains($url, '/api/products/setReduction')) {
                return Http::response(['ok' => false, 'errors' => ['blocked_by_flash_sale']], 409);
            }

            return Http::response(['error' => 'x'], 400);
        });

        $runner = app(BatchRunner::class);
        $op = $runner->createBatch([['product_id' => 49, 'reduction' => 15]], '2026-08-18', '2026-09-18');
        $runner->confirmAndRun($op);

        $this->assertSame(ItemState::SkippedFlashSale, $op->items()->first()->state);
        $this->assertDatabaseHas('audit_log', ['product_id' => 49, 'result' => 'skipped']);
    }
}
