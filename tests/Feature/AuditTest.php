<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\Audit\AuditRecorder;
use App\Services\Audit\SnapshotService;
use App\Services\Export\AuditExporter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AuditTest extends TestCase
{
    use RefreshDatabase;

    public function test_hash_chain_is_valid_across_entries(): void
    {
        $rec = app(AuditRecorder::class);
        $a = $rec->record(['action' => 'set', 'product_id' => 49, 'result' => 'ok']);
        $b = $rec->record(['action' => 'set', 'product_id' => 50, 'result' => 'ok']);

        $this->assertNull($a->hash_prev);
        $this->assertSame($a->hash_self, $b->hash_prev);
        $this->assertTrue($rec->verifyChain()['ok']);
    }

    public function test_api_key_is_redacted_in_audit(): void
    {
        $rec = app(AuditRecorder::class);
        $entry = $rec->record([
            'action' => 'set',
            'params' => ['id' => 49, 'X-Api-Key' => 'super-secret', 'authorization' => 'Bearer x'],
        ]);

        $this->assertSame('[redacted]', $entry->params['X-Api-Key']);
        $this->assertSame('[redacted]', $entry->params['authorization']);
        $this->assertSame(49, $entry->params['id']);
    }

    public function test_tampering_breaks_the_chain(): void
    {
        $rec = app(AuditRecorder::class);
        $rec->record(['action' => 'set', 'product_id' => 49, 'result' => 'ok']);
        $mid = $rec->record(['action' => 'set', 'product_id' => 50, 'result' => 'ok']);
        $rec->record(['action' => 'clear', 'product_id' => 51, 'result' => 'ok']);

        // Zásah mimo appky (bypass ORM guardu).
        DB::table('audit_log')->where('id', $mid->id)->update(['result' => 'tampered']);

        $verdict = $rec->verifyChain();
        $this->assertFalse($verdict['ok']);
        $this->assertSame($mid->id, $verdict['broken_at']);
    }

    public function test_snapshot_captures_diff(): void
    {
        $svc = app(SnapshotService::class);
        $before = ['reduction_percent' => null, 'margin_percent' => 40, 'sell_price_with_vat' => 24, 'active' => true, 'qty' => 5];
        $after = ['reduction_percent' => 15, 'margin_percent' => 29, 'sell_price_with_vat' => 20.4, 'active' => true, 'qty' => 5];

        $svc->capture(null, 49, 'before', $before);
        $snap = $svc->capture(null, 49, 'after', $after, $before);

        $this->assertArrayHasKey('reduction_percent', $snap->diff);
        $this->assertSame(['from' => null, 'to' => 15], $snap->diff['reduction_percent']);
        $this->assertArrayNotHasKey('qty', $snap->diff); // nezmenené
        $this->assertNotNull($snap->expires_at);
    }

    public function test_export_csv_and_json_have_no_secrets(): void
    {
        $rec = app(AuditRecorder::class);
        $rec->record(['action' => 'set', 'product_id' => 49, 'result' => 'ok', 'params' => ['id' => 49, 'X-Api-Key' => 'secret']]);

        $exp = app(AuditExporter::class);
        $csv = $exp->toCsv();
        $json = $exp->toJson();

        $this->assertStringContainsString('action', $csv);
        $this->assertStringNotContainsString('secret', $csv);
        $this->assertStringNotContainsString('secret', $json);
        $this->assertStringContainsString('[redacted]', $json);
    }
}
