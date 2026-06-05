import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { User } from '../../users/entities/user.entity';
import { EntitlementService } from '../entitlement.service';
import { FREE_DAILY_UPLOAD_LIMIT } from '../plans.config';
import { UsageService } from '../usage.service';

/**
 * Enforces the post-trial Free limit of 1 receipt upload/day. Pro and in-trial
 * users pass straight through. For everyone else the slot is reserved
 * atomically here, so the OCR/extraction work only runs when within quota and
 * concurrent requests can't both slip past.
 *
 * Returns HTTP 402 Payment Required when the limit is hit → the client shows
 * the upgrade paywall.
 */
@Injectable()
export class DailyQuotaGuard implements CanActivate {
  constructor(
    private readonly entitlements: EntitlementService,
    private readonly usage: UsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user: User }>();
    const user = req.user;

    const ent = await this.entitlements.resolve(user);
    if (ent.isPro) return true; // unlimited

    const granted = await this.usage.tryConsume(
      user.id,
      FREE_DAILY_UPLOAD_LIMIT,
    );
    if (!granted) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error: 'Daily upload limit reached',
          message:
            'Free plan allows 1 receipt per day. Upgrade to Pro for unlimited uploads.',
          dailyUploadLimit: FREE_DAILY_UPLOAD_LIMIT,
          upgrade: true,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return true;
  }
}
