<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Services\Batch\PreflightValidator;
use Tests\TestCase;

class PreflightValidatorTest extends TestCase
{
    private PreflightValidator $v;

    protected function setUp(): void
    {
        parent::setUp();
        $this->v = new PreflightValidator;
    }

    public function test_valid_case(): void
    {
        $this->assertSame([], $this->v->validate(15, '2026-08-18', '2026-09-18'));
    }

    public function test_zero_is_invalid_reduction(): void
    {
        $this->assertContains('invalid_reduction', $this->v->validate(0, '2026-08-18', '2026-08-30'));
    }

    public function test_over_thirty_is_invalid(): void
    {
        $this->assertContains('invalid_reduction', $this->v->validate(35, '2026-08-18', '2026-08-30'));
    }

    public function test_bad_step_is_invalid(): void
    {
        $this->assertContains('invalid_reduction', $this->v->validate(15.3, '2026-08-18', '2026-08-30'));
    }

    public function test_to_before_from_is_invalid_dates(): void
    {
        $this->assertContains('invalid_dates', $this->v->validate(15, '2026-08-30', '2026-08-18'));
    }

    public function test_window_over_three_months_is_range_too_long(): void
    {
        $this->assertContains('range_too_long', $this->v->validate(15, '2026-01-01', '2026-05-01'));
    }

    public function test_bad_format_is_invalid_dates(): void
    {
        $this->assertContains('invalid_dates', $this->v->validate(15, '18.08.2026', '2026-08-30'));
    }
}
