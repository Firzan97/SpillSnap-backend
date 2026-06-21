import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { User } from '../../users/entities/user.entity';
import { AiUsageService } from '../ai-usage.service';
import { EntitlementService } from '../entitlement.service';
import { FREE_DAILY_SCAN_CAP } from '../plans.config';

/**
 * Anti-abuse cap on receipt *scans* for Free users. Saving a receipt is what
 * spends the monthly quota (see DailyQuotaGuard on POST /receipts), but every
 * scan still runs a paid AI extraction — so without a ceiling a free user could
 * scan endlessly and run up cost while never saving. Pro users bypass.
 *
 * Returns HTTP 429 Too Many Requests when the daily cap is hit (distinct from
 * the 402 paywall the save quota raises — this is rate-limiting, not an upsell).
 */
@Injectable()
export class ScanRateLimitGuard implements CanActivate {
  constructor(
    private readonly entitlements: EntitlementService,
    private readonly aiUsage: AiUsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user: User }>();
    const user = req.user;

    const ent = await this.entitlements.resolve(user);
    if (ent.isPro) return true; // unlimited scans for Pro

    const used = await this.aiUsage.scansToday(user.id);
    if (used >= FREE_DAILY_SCAN_CAP) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Daily scan limit reached',
          message: `You've reached today's limit of ${FREE_DAILY_SCAN_CAP} scans. Try again tomorrow, or upgrade to Pro for unlimited scanning.`,
          dailyScanCap: FREE_DAILY_SCAN_CAP,
          upgrade: true,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
