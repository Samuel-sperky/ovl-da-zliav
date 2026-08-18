<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\Api\ResponseNormalizer;
use PHPUnit\Framework\TestCase;

class ResponseNormalizerTest extends TestCase
{
    private ResponseNormalizer $n;

    protected function setUp(): void
    {
        $this->n = new ResponseNormalizer;
    }

    public function test_unwraps_result_success(): void
    {
        $r = $this->n->normalize(['result' => ['ok' => true, 'id' => 49]], 200);
        $this->assertTrue($r->success);
        $this->assertSame(49, $r->data['id']);
        $this->assertSame([], $r->errorCodes);
    }

    public function test_list_wrapper_success(): void
    {
        $r = $this->n->normalize(['result' => ['data' => [1, 2, 3], 'total' => 3]], 200);
        $this->assertTrue($r->success);
        $this->assertSame([1, 2, 3], $r->data['data']);
    }

    public function test_unwrapped_forbidden(): void
    {
        $r = $this->n->normalize(['error' => 'forbidden'], 403);
        $this->assertFalse($r->success);
        $this->assertTrue($r->isForbidden());
        $this->assertSame('forbidden', $r->firstError());
    }

    public function test_set_reduction_errors_without_wrapper(): void
    {
        $r = $this->n->normalize(['ok' => false, 'errors' => ['invalid_reduction']], 400);
        $this->assertFalse($r->success);
        $this->assertContains('invalid_reduction', $r->errorCodes);
    }

    public function test_order_get_200_but_ok_false(): void
    {
        $r = $this->n->normalize(['result' => ['ok' => false, 'error' => 'not found']], 200);
        $this->assertFalse($r->success);
        $this->assertContains('not found', $r->errorCodes);
    }

    public function test_flash_sale_409(): void
    {
        $r = $this->n->normalize(['ok' => false, 'errors' => ['blocked_by_flash_sale']], 409);
        $this->assertFalse($r->success);
        $this->assertTrue($r->isFlashSaleBlocked());
    }

    public function test_rate_limited_429(): void
    {
        $r = $this->n->normalize(['error' => 'rate_limited'], 429);
        $this->assertTrue($r->isRateLimited());
    }

    public function test_http_status_derived_code_when_body_empty(): void
    {
        $r = $this->n->normalize(null, 500);
        $this->assertFalse($r->success);
        $this->assertContains('request_failed', $r->errorCodes);
    }

    public function test_range_too_long_from_body(): void
    {
        $r = $this->n->normalize(['ok' => false, 'errors' => ['range_too_long']], 400);
        $this->assertContains('range_too_long', $r->errorCodes);
    }
}
