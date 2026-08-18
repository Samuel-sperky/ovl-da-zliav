<?php

declare(strict_types=1);

namespace App\Enums;

/**
 * Stavový automat položky dávky.
 *
 * pending → dry_run_ok → awaiting_confirm → queued → sent → verified
 * vetvy: failed · compensated · skipped_flash_sale · skipped_low_margin · uncertain
 */
enum ItemState: string
{
    case Pending = 'pending';
    case DryRunOk = 'dry_run_ok';
    case AwaitingConfirm = 'awaiting_confirm';
    case Queued = 'queued';
    case Sent = 'sent';
    case Verified = 'verified';
    case Failed = 'failed';
    case Compensated = 'compensated';
    case SkippedFlashSale = 'skipped_flash_sale';
    case SkippedLowMargin = 'skipped_low_margin';
    case Uncertain = 'uncertain';

    /** Povolené prechody medzi stavmi. */
    public function canTransitionTo(self $next): bool
    {
        return in_array($next, $this->allowedNext(), true);
    }

    /** @return list<self> */
    public function allowedNext(): array
    {
        return match ($this) {
            self::Pending => [self::DryRunOk, self::SkippedLowMargin, self::SkippedFlashSale, self::Failed],
            self::DryRunOk => [self::AwaitingConfirm, self::SkippedLowMargin, self::Failed],
            self::AwaitingConfirm => [self::Queued, self::Failed],
            self::Queued => [self::Sent, self::SkippedFlashSale, self::Failed, self::Uncertain],
            self::Sent => [self::Verified, self::Uncertain, self::Failed],
            self::Uncertain => [self::Verified, self::Failed, self::Compensated],
            self::Verified => [self::Compensated],
            self::Failed => [self::Compensated],
            self::SkippedFlashSale, self::SkippedLowMargin, self::Compensated => [],
        };
    }

    /** Terminálny stav — už sa ďalej nemení automaticky. */
    public function isTerminal(): bool
    {
        return $this->allowedNext() === [];
    }

    /** Reálne zapísané do shopu (kandidát na kompenzáciu). */
    public function isWritten(): bool
    {
        return in_array($this, [self::Sent, self::Verified], true);
    }

    public function isSkipped(): bool
    {
        return in_array($this, [self::SkippedFlashSale, self::SkippedLowMargin], true);
    }
}
