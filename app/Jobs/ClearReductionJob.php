<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Models\OperationItem;
use App\Services\Batch\ItemWriter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

class ClearReductionJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public int $operationItemId) {}

    public function middleware(): array
    {
        return [(new WithoutOverlapping('sperky-write'))->releaseAfter(5)->expireAfter(300)];
    }

    public function uniqueId(): string
    {
        return 'clear-'.$this->operationItemId;
    }

    public function handle(ItemWriter $writer): void
    {
        $item = OperationItem::find($this->operationItemId);
        if ($item !== null) {
            $writer->clearItem($item);
        }
    }
}
