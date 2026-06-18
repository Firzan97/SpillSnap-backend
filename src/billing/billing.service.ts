import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import { User, UserRole } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { CheckoutDto, CheckoutPlatform } from './dto/checkout.dto';
import {
  PlanId,
  Subscription,
  SubscriptionStatus,
} from './entities/subscription.entity';
import { SubscriptionEvent } from './entities/subscription-event.entity';
import { EntitlementService } from './entitlement.service';
import { StripeService } from './stripe.service';
import { WhatsappSenderService } from '../whatsapp/whatsapp-sender.service';
import { AppConfigService } from '../config/app-config.service';
import {
  PRICING_CONFIG_KEY,
  PricingPayload,
  pricingDefault,
} from './plans.config';

// Stripe → local status mapping.
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  trialing: SubscriptionStatus.TRIALING,
  active: SubscriptionStatus.ACTIVE,
  past_due: SubscriptionStatus.PAST_DUE,
  unpaid: SubscriptionStatus.PAST_DUE,
  canceled: SubscriptionStatus.CANCELED,
  incomplete_expired: SubscriptionStatus.EXPIRED,
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(SubscriptionEvent)
    private readonly eventRepo: Repository<SubscriptionEvent>,
    private readonly stripe: StripeService,
    private readonly users: UsersService,
    private readonly entitlements: EntitlementService,
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsappSenderService,
    private readonly appConfig: AppConfigService,
  ) {}

  private appUrl(): string {
    return this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:8081';
  }

  /**
   * Public website origin that hosts the Stripe success/cancel pages. Stripe
   * only accepts http(s) redirect URLs (never custom schemes like spillsnap://),
   * so the mobile flow lands on these web pages, which then deep-link back into
   * the app. Falls back to FRONTEND_URL for local/dev.
   */
  private webUrl(): string {
    // Public website origin only. Do NOT fall back to FRONTEND_URL — on prod
    // that's the app origin (e.g. http://localhost:8081), which made Stripe
    // redirect mobile users to localhost after payment. WEB_URL if set, else
    // the real public site.
    return this.config.get<string>('WEB_URL') ?? 'https://spillsnap.com';
  }

  /**
   * Build the Stripe return URLs. Mobile platforms get `?app=1` so the web
   * success/cancel page bounces back into the app via the spillsnap:// scheme;
   * web checkout stays on the website.
   */
  private billingReturnUrls(platform?: CheckoutPlatform): {
    successUrl: string;
    cancelUrl: string;
  } {
    const base = this.webUrl();
    const isMobile =
      platform === CheckoutPlatform.IOS ||
      platform === CheckoutPlatform.ANDROID;
    const q = isMobile ? '?app=1' : '';
    return {
      successUrl: `${base}/billing/success${q}`,
      cancelUrl: `${base}/billing/cancel${q}`,
    };
  }

  /** Start a hosted Checkout for Pro. Returns the URL the client opens. */
  async createCheckout(user: User, dto: CheckoutDto): Promise<{ url: string }> {
    const existing = await this.entitlements.findSubscription(user.id);

    // Already on a live paid plan? Don't let them open a second checkout (which
    // would create a duplicate Stripe subscription). Gate on a real Stripe
    // subscription id so we don't block the pre-checkout placeholder record or
    // a user converting their app trial into their first paid plan. They manage
    // an existing plan via the Customer Portal instead.
    const hasLivePaidPlan =
      !!existing?.stripeSubscriptionId &&
      (existing.status === SubscriptionStatus.ACTIVE ||
        existing.status === SubscriptionStatus.TRIALING) &&
      (!existing.currentPeriodEnd || existing.currentPeriodEnd > new Date());
    if (hasLivePaidPlan) {
      throw new ConflictException(
        'You already have an active subscription. Manage it from your account billing page.',
      );
    }

    const customerId = await this.stripe.ensureCustomer({
      userId: user.id,
      email: user.email,
      name: user.name,
      existingCustomerId: existing?.stripeCustomerId ?? null,
    });

    // Persist the customer id early so we never create duplicate customers.
    await this.upsert(user.id, {
      stripeCustomerId: customerId,
      status: existing?.status ?? SubscriptionStatus.TRIALING,
    });

    // Free trial is granted HERE, on first Pro checkout (card collected now,
    // first charge deferred until the trial ends), and is once per user. A user
    // who has had a Stripe subscription before is billed immediately — no second
    // free trial. The length is admin-editable via the pricing config; 0 days
    // disables it. (The Stripe Price must NOT have its own default trial set, or
    // it would apply regardless; trials are controlled here via trial_end.)
    const trialAlreadyUsed = !!existing?.stripeSubscriptionId;
    const pricing = await this.appConfig.get<PricingPayload>(
      PRICING_CONFIG_KEY,
      pricingDefault(),
    );
    const trialDays = pricing.trialDays ?? 0;
    const trialEnd =
      !trialAlreadyUsed && trialDays > 0
        ? Math.floor(Date.now() / 1000) + trialDays * 86_400
        : undefined;

    const { successUrl, cancelUrl } = this.billingReturnUrls(dto.platform);
    const url = await this.stripe.createCheckoutSession({
      customerId,
      priceId: this.stripe.priceIdFor(dto.interval),
      userId: user.id,
      successUrl,
      cancelUrl,
      trialEnd,
    });
    return { url };
  }

  /** Open the Stripe Customer Portal (cancel / update card). */
  async createPortal(user: User): Promise<{ url: string }> {
    const sub = await this.entitlements.findSubscription(user.id);
    if (!sub?.stripeCustomerId) {
      throw new NotFoundException('No billing account for this user yet');
    }
    const url = await this.stripe.createPortalSession(
      sub.stripeCustomerId,
      `${this.appUrl()}/billing`,
    );
    return { url };
  }

  // ── Webhook ────────────────────────────────────────────────────────────────
  async handleWebhook(rawBody: Buffer, signature?: string): Promise<void> {
    const event = this.stripe.constructEvent(rawBody, signature);

    // Idempotency: a duplicate delivery hits the PK and is skipped.
    const seen = await this.eventRepo.findOne({
      where: { stripeEventId: event.id },
    });
    if (seen) {
      this.logger.debug(`Skipping duplicate Stripe event ${event.id}`);
      return;
    }

    let userId: string | null = null;
    try {
      userId = await this.dispatch(event);
    } finally {
      await this.eventRepo.save({
        stripeEventId: event.id,
        type: event.type,
        userId,
      });
    }
  }

  private async dispatch(event: Stripe.Event): Promise<string | null> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (!subId) return null;
        const sub = await this.stripe.getSubscription(subId);
        return this.syncFromStripe(sub, session.client_reference_id);
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        return this.syncFromStripe(event.data.object);
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        // Stripe moved the subscription ref under invoice.parent in recent API
        // versions (the top-level invoice.subscription field was removed).
        const subscription = invoice.parent?.subscription_details?.subscription;
        const subId =
          typeof subscription === 'string' ? subscription : subscription?.id;
        if (!subId) return null;
        const sub = await this.stripe.getSubscription(subId);
        return this.syncFromStripe(sub);
      }
      default:
        this.logger.debug(`Unhandled Stripe event ${event.type}`);
        return null;
    }
  }

  /** Map a Stripe subscription onto our local row + user role. */
  private async syncFromStripe(
    sub: Stripe.Subscription,
    fallbackUserId?: string | null,
  ): Promise<string | null> {
    const userId =
      sub.metadata?.userId ??
      fallbackUserId ??
      (await this.userIdByCustomer(sub.customer));
    if (!userId) {
      this.logger.warn(`No userId for Stripe subscription ${sub.id}`);
      return null;
    }

    const item = sub.items.data[0];
    const periodEndUnix =
      item?.current_period_end ??
      (sub as unknown as { current_period_end?: number }).current_period_end;
    const status = STATUS_MAP[sub.status] ?? SubscriptionStatus.EXPIRED;

    await this.upsert(userId, {
      plan: PlanId.PRO,
      status,
      stripeCustomerId:
        typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      stripeSubscriptionId: sub.id,
      stripePriceId: item?.price.id ?? null,
      billingInterval: this.stripe.intervalForPrice(item?.price.id),
      currentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    });

    // Keep the denormalised role cache in sync for quick checks elsewhere.
    const isProNow =
      status === SubscriptionStatus.ACTIVE ||
      status === SubscriptionStatus.TRIALING;

    // Was this user Pro before this event? (role cache is the prior state)
    const before = await this.users.findById(userId).catch(() => null);
    const wasPro = before?.role === UserRole.PRO;

    await this.users.update(userId, {
      role: isProNow ? UserRole.PRO : UserRole.FREE,
    });

    // First time they become Pro → WhatsApp welcome ping (cold → needs template).
    if (isProNow && !wasPro && before) {
      void this.sendProWelcome(before);
    }

    return userId;
  }

  /**
   * Cold business-initiated WhatsApp message → must be an approved template.
   * No-op unless the sender is configured, a template name is set, and the user
   * has a phone number. Best-effort; never throws into the webhook flow.
   */
  private async sendProWelcome(user: User): Promise<void> {
    const phone = user.phone?.replace(/\D/g, '');
    if (!phone) return;
    const firstName = user.name?.split(/\s+/)[0] || 'there';
    try {
      await this.whatsapp.sendWelcome(phone, firstName);
    } catch (e) {
      this.logger.warn(`Pro-welcome WhatsApp failed: ${(e as Error).message}`);
    }
  }

  private async userIdByCustomer(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer,
  ): Promise<string | null> {
    const customerId = typeof customer === 'string' ? customer : customer.id;
    const sub = await this.subRepo.findOne({
      where: { stripeCustomerId: customerId },
    });
    return sub?.userId ?? null;
  }

  /** Insert or update the single subscription row for a user. */
  private async upsert(
    userId: string,
    patch: Partial<Subscription>,
  ): Promise<void> {
    const existing = await this.subRepo.findOne({ where: { userId } });
    if (existing) {
      await this.subRepo.update({ userId }, patch);
    } else {
      await this.subRepo.save(
        this.subRepo.create({
          userId,
          status: SubscriptionStatus.TRIALING,
          ...patch,
        }),
      );
    }
  }

  /** Validate the webhook isn't being abused with a non-Buffer body. */
  assertRawBody(rawBody: unknown): Buffer {
    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException('Webhook body must be raw');
    }
    return rawBody;
  }
}
