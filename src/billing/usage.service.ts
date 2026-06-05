import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyUsage } from './entities/daily-usage.entity';

/** Calendar date (YYYY-MM-DD) in Malaysia time — the quota resets at MY midnight. */
export function malaysiaDay(now: Date = new Date()): string {
  // en-CA renders ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(DailyUsage)
    private readonly repo: Repository<DailyUsage>,
  ) {}

  /** How many uploads the user has already made today (MY time). */
  async todayCount(userId: string): Promise<number> {
    const row = await this.repo.findOne({
      where: { userId, day: malaysiaDay() },
    });
    return row?.count ?? 0;
  }

  /**
   * Atomically reserve one upload for today if under `limit`. Returns true if
   * the slot was granted, false if the daily limit is already reached.
   *
   * The conditional UPSERT means two concurrent requests can't both slip past
   * the limit: the second one's UPDATE predicate fails and returns no row.
   */
  async tryConsume(userId: string, limit: number): Promise<boolean> {
    const day = malaysiaDay();
    // repo.query is typed `Promise<any>`; the result is the array of RETURNING
    // rows (empty when the WHERE predicate blocked the upsert).
    const result: unknown[] = await this.repo.query(
      `INSERT INTO daily_usage (user_id, day, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, day)
       DO UPDATE SET count = daily_usage.count + 1
       WHERE daily_usage.count < $3
       RETURNING count`,
      [userId, day, limit],
    );

    return result.length > 0;
  }

  /**
   * Give back one reserved upload for today (floor 0). Used when a slot was
   * consumed by the quota guard but the upload was then rejected — e.g. the
   * image turned out not to be a receipt — so it shouldn't count against quota.
   */
  async refund(userId: string): Promise<void> {
    await this.repo.query(
      `UPDATE daily_usage SET count = GREATEST(count - 1, 0)
       WHERE user_id = $1 AND day = $2`,
      [userId, malaysiaDay()],
    );
  }
}
