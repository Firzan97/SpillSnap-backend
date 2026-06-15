import { HttpException, HttpStatus } from '@nestjs/common';
import { Entitlement } from './entitlement.service';

/**
 * Throw HTTP 402 Payment Required when a feature is Pro-only and the user isn't
 * Pro (matches DailyQuotaGuard's shape, so the client shows the same upgrade
 * paywall). `feature` is woven into the message for clarity.
 */
export function assertPro(ent: Entitlement, feature: string): void {
  if (ent.isPro) return;
  throw new HttpException(
    {
      statusCode: HttpStatus.PAYMENT_REQUIRED,
      error: 'Pro feature',
      message: `${feature} is a SpillSnap Pro feature. Upgrade to unlock it.`,
      upgrade: true,
    },
    HttpStatus.PAYMENT_REQUIRED,
  );
}
