import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Atomic per-day upload counter used to enforce the post-trial Free limit
 * (1 receipt upload/day). Keyed by (userId, day) where `day` is the calendar
 * date in Asia/Kuala_Lumpur (YYYY-MM-DD). The counter is incremented with a
 * single conditional UPSERT so concurrent uploads can't bypass the limit.
 */
@Entity('daily_usage')
export class DailyUsage {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'day', type: 'date' })
  day: string; // YYYY-MM-DD, Asia/Kuala_Lumpur

  @Column({ type: 'int', default: 0 })
  count: number;
}
