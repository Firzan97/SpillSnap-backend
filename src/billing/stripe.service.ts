import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { BillingInterval } from './entities/subscription.entity';

/**
 * Thin wrapper around the Stripe SDK. Keeping every Stripe call behind this
 * service means the rest of the app stays provider-agnostic - a future Chip /
 * Lemon Squeezy adapter would implement the same surface.
 */
@Injectable()
export class StripeService {
  private readonly stripe: InstanceType<typeof Stripe>;
  private readonly webhookSecret: string;
  private readonly priceByInterval: Record<BillingInterval, string | undefined>;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(
      this.config.getOrThrow<string>('STRIPE_SECRET_KEY'),
    );
    this.webhookSecret = this.config.getOrThrow<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    this.priceByInterval = {
      [BillingInterval.MONTHLY]: this.config.get<string>(
        'STRIPE_PRICE_PRO_MONTHLY',
      ),
      [BillingInterval.ANNUAL]: this.config.get<string>(
        'STRIPE_PRICE_PRO_ANNUAL',
      ),
    };
  }

  priceIdFor(interval: BillingInterval): string {
    const priceId = this.priceByInterval[interval];
    if (!priceId) {
      throw new InternalServerErrorException(
        `No Stripe price configured for ${interval}`,
      );
    }
    return priceId;
  }

  intervalForPrice(priceId: string | null | undefined): BillingInterval | null {
    if (priceId === this.priceByInterval[BillingInterval.MONTHLY]) {
      return BillingInterval.MONTHLY;
    }
    if (priceId === this.priceByInterval[BillingInterval.ANNUAL]) {
      return BillingInterval.ANNUAL;
    }
    return null;
  }

  /** Find an existing Stripe customer by our user id, or create one. */
  async ensureCustomer(params: {
    userId: string;
    email: string;
    name: string;
    existingCustomerId: string | null;
  }): Promise<string> {
    if (params.existingCustomerId) return params.existingCustomerId;
    const customer = await this.stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: { userId: params.userId },
    });
    return customer.id;
  }

  /**
   * Create a hosted Checkout session for a Pro subscription. `trialDays` defers
   * the first charge until the trial ends, so the card is collected now but not
   * billed during the trial. Use Stripe's integer `trial_period_days` (not an
   * absolute trial_end): Checkout floors an absolute end timestamp by elapsed
   * render time, so "5 days" would show as "4 days free".
   */
  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    userId: string;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
  }): Promise<string> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: params.customerId,
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      client_reference_id: params.userId,
      subscription_data: {
        metadata: { userId: params.userId },
        ...(params.trialDays && params.trialDays > 0
          ? { trial_period_days: params.trialDays }
          : {}),
      },
    });
    if (!session.url) {
      throw new InternalServerErrorException('Stripe returned no checkout URL');
    }
    return session.url;
  }

  /** Hosted Customer Portal - lets the user cancel / update card themselves. */
  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  async getSubscription(id: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(id);
  }

  /** Verify the signature and parse a webhook payload from its raw body. */
  constructEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }
  }
}
