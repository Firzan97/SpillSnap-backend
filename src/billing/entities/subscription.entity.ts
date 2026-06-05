import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PlanId {
  FREE = 'free',
  PRO = 'pro',
}

export enum BillingInterval {
  MONTHLY = 'monthly',
  ANNUAL = 'annual',
}

/**
 * Mirrors the Stripe subscription state. Values map onto Stripe's statuses:
 * trialing → active → past_due → canceled. `expired` is our terminal local
 * state once a canceled/ended sub's period is over.
 */
export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  EXPIRED = 'expired',
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // One subscription row per user.
  @Column({ name: 'user_id', type: 'uuid', unique: true })
  @Index()
  userId: string;

  @Column({ type: 'enum', enum: PlanId, default: PlanId.PRO })
  plan: PlanId;

  @Column({ type: 'enum', enum: SubscriptionStatus })
  status: SubscriptionStatus;

  @Column({
    name: 'billing_interval',
    type: 'enum',
    enum: BillingInterval,
    nullable: true,
  })
  billingInterval: BillingInterval | null;

  // ── Stripe linkage ─────────────────────────────────────────────────────────
  @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
  @Index()
  stripeCustomerId: string | null;

  @Column({ name: 'stripe_subscription_id', type: 'varchar', nullable: true })
  stripeSubscriptionId: string | null;

  @Column({ name: 'stripe_price_id', type: 'varchar', nullable: true })
  stripePriceId: string | null;

  // ── Period / lifecycle ───────────────────────────────────────────────────────
  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trialEndsAt: Date | null;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
