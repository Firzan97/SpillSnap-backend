import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * One row per processed Stripe webhook event. The Stripe event id is the
 * primary key, giving us idempotency for free: a duplicate delivery hits the
 * unique constraint and is skipped. Also serves as an audit trail.
 */
@Entity('subscription_events')
export class SubscriptionEvent {
  @PrimaryColumn({ name: 'stripe_event_id', type: 'varchar' })
  stripeEventId: string;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt: Date;
}
