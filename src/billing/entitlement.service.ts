import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import {
  BillingInterval,
  PlanId,
  Subscription,
  SubscriptionStatus,
} from './entities/subscription.entity';
import {
  AppLimits,
  DEFAULT_LIMITS,
  FREE_FEATURES,
  LIMITS_CONFIG_KEY,
  PRO_FEATURES,
  PlanFeatures,
} from './plans.config';
import { UsageService } from './usage.service';
import { AppConfigService } from '../config/app-config.service';

export interface Entitlement {
  plan: PlanId;
  status: SubscriptionStatus;
  isPro: boolean; // trialing or actively subscribed
  subscribed: boolean; // has a paid subscription (card on file) — distinct from the free trial
  canSnap: boolean; // may upload a receipt right now
  uploadsThisMonth: number;
  monthlyUploadLimit: number | null; // null = unlimited
  features: PlanFeatures;
  trialEndsAt: Date | null;
  trialDaysLeft: number;
  renewsAt: Date | null;
  billingInterval: BillingInterval | null;
  cancelAtPeriodEnd: boolean;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
}

@Injectable()
export class EntitlementService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    private readonly usage: UsageService,
    private readonly appConfig: AppConfigService,
  ) {}

  async findSubscription(userId: string): Promise<Subscription | null> {
    return this.subRepo.findOne({ where: { userId } });
  }

  /**
   * Resolve what a user is entitled to right now. Pro access comes from either
   * an in-progress free trial (User.trialEndsAt) or an active paid Stripe
   * subscription. Everyone else is post-trial Free: 1 upload/day.
   */
  async resolve(user: User): Promise<Entitlement> {
    const now = new Date();
    const sub = await this.findSubscription(user.id);

    // Pro from a paid plan requires a REAL Stripe subscription (id set by the
    // webhook AFTER successful payment). Gating on stripeSubscriptionId means
    // merely STARTING checkout (which pre-creates a customer row) — or
    // cancelling it — never grants Pro.
    const paidActive =
      !!sub &&
      !!sub.stripeSubscriptionId &&
      (sub.status === SubscriptionStatus.ACTIVE ||
        sub.status === SubscriptionStatus.TRIALING) &&
      (!sub.currentPeriodEnd || sub.currentPeriodEnd > now);

    const trialActive = !!user.trialEndsAt && new Date(user.trialEndsAt) > now;

    const isPro = paidActive || trialActive;

    const limits = await this.appConfig.get<AppLimits>(
      LIMITS_CONFIG_KEY,
      DEFAULT_LIMITS,
    );
    const uploadsThisMonth = await this.usage.monthCount(user.id);
    const monthlyUploadLimit = isPro ? null : limits.freeMonthlyScans;
    const canSnap = isPro || uploadsThisMonth < limits.freeMonthlyScans;

    let status: SubscriptionStatus;
    if (paidActive) {
      // Report Stripe's real status. When a user subscribes during the 7-day app
      // trial, Stripe defers the first charge and marks the subscription
      // 'trialing' until trial_end, then flips to 'active'. We surface that as-is
      // so the account page reads "trialing" until the trial date passes, then
      // "active". `subscribed` (below) distinguishes a paying card-on-file user
      // from a card-less free trial regardless of this status.
      status = sub!.status;
    } else if (trialActive) {
      status = SubscriptionStatus.TRIALING; // free, card-less app trial only
    } else {
      status = sub?.status ?? SubscriptionStatus.EXPIRED;
    }

    return {
      plan: isPro ? PlanId.PRO : PlanId.FREE,
      status,
      isPro,
      subscribed: paidActive,
      canSnap,
      uploadsThisMonth,
      monthlyUploadLimit,
      features: isPro ? PRO_FEATURES : FREE_FEATURES,
      trialEndsAt: user.trialEndsAt ?? null,
      trialDaysLeft: user.trialEndsAt
        ? daysBetween(now, new Date(user.trialEndsAt))
        : 0,
      renewsAt: paidActive ? (sub?.currentPeriodEnd ?? null) : null,
      billingInterval: sub?.billingInterval ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    };
  }
}
