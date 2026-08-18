<?php

declare(strict_types=1);

namespace App\Services\Api;

/**
 * Kanonický výsledok volania SPERKY API — jednotný naprieč všetkými tvarmi odpovede.
 */
final readonly class NormalizedResponse
{
    /**
     * @param  array<string,mixed>  $data      užitočná časť (rozbalený `result` alebo top-level)
     * @param  list<string>  $errorCodes        kódy chýb (napr. blocked_by_flash_sale)
     */
    public function __construct(
        public bool $success,
        public array $data,
        public array $errorCodes,
        public int $httpStatus,
    ) {}

    public function firstError(): ?string
    {
        return $this->errorCodes[0] ?? null;
    }

    public function hasError(string $code): bool
    {
        return in_array($code, $this->errorCodes, true);
    }

    public function isFlashSaleBlocked(): bool
    {
        return $this->hasError('blocked_by_flash_sale') || $this->httpStatus === 409;
    }

    public function isRateLimited(): bool
    {
        return $this->hasError('rate_limited') || $this->httpStatus === 429;
    }

    public function isForbidden(): bool
    {
        return $this->hasError('forbidden') || $this->httpStatus === 403;
    }
}
