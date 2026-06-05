import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Receipt } from '../receipts/entities/receipt.entity';
import { User } from '../users/entities/user.entity';
import { PushToken } from '../push/entities/push-token.entity';
import { NotificationsService } from './notifications.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// A small rotating pool of tips, indexed by ISO week so everyone sees the same
// one and it changes weekly.
const TIPS = [
  'Snap receipts the moment you pay — it only takes a second and keeps your streak alive.',
  'Tag receipts with #tax as you go to make e-Filing season effortless.',
  'Pro unlocks WhatsApp receipt upload — forward a photo and we file it for you.',
  'Reviewing categories weekly keeps your spending insights sharp.',
];

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    private readonly notifications: NotificationsService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Receipt)
    private readonly receipts: Repository<Receipt>,
    @InjectRepository(PushToken)
    private readonly tokens: Repository<PushToken>,
  ) {}

  private startOfToday(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  private snappedToday(user: User): boolean {
    if (!user.lastSnapAt) return false;
    return new Date(user.lastSnapAt).getTime() >= this.startOfToday();
  }

  /** Only message users who actually have a registered device. */
  private async usersWithDevices(): Promise<User[]> {
    const rows = await this.tokens
      .createQueryBuilder('t')
      .select('DISTINCT t.user_id', 'userId')
      .getRawMany<{ userId: string }>();
    const ids = rows.map((r) => r.userId);
    if (ids.length === 0) return [];
    return this.users.find({ where: { id: In(ids) } });
  }

  // ── Daily snap reminder — 20:00 every day ────────────────────────────────────
  @Cron('0 20 * * *', { name: 'daily-snap-reminder' })
  async dailySnapReminder(): Promise<void> {
    const users = await this.usersWithDevices();
    let sent = 0;
    for (const user of users) {
      if (this.snappedToday(user)) continue;
      // Skip brand-new users who have never snapped — nothing to remind about.
      if (!user.lastSnapAt) continue;
      await this.notifications.notify(user.id, {
        type: 'receipt',
        emoji: '📸',
        title: 'Snap today’s receipts',
        body: "You haven't logged a receipt today. Snap one to keep your streak going.",
        prefKey: 'snap',
      });
      sent++;
    }
    this.logger.log(`daily-snap-reminder: ${sent} sent`);
  }

  // ── Streak at risk — 21:00 every day ─────────────────────────────────────────
  @Cron('0 21 * * *', { name: 'streak-at-risk' })
  async streakAtRisk(): Promise<void> {
    const users = await this.users.find({
      where: { streakCount: Not(IsNull()), lastSnapAt: Not(IsNull()) },
    });
    let sent = 0;
    for (const user of users) {
      if ((user.streakCount ?? 0) < 1) continue;
      if (this.snappedToday(user)) continue;
      await this.notifications.notify(user.id, {
        type: 'streak',
        emoji: '🔥',
        title: `Your ${user.streakCount}-day streak is at risk`,
        body: 'Snap a receipt before midnight to keep your streak alive.',
        data: { streak: user.streakCount },
        prefKey: 'streak',
      });
      sent++;
    }
    this.logger.log(`streak-at-risk: ${sent} sent`);
  }

  // ── Weekly summary — Sundays 18:00 ───────────────────────────────────────────
  @Cron('0 18 * * 0', { name: 'weekly-summary' })
  async weeklySummary(): Promise<void> {
    const users = await this.usersWithDevices();
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);
    let sent = 0;
    for (const user of users) {
      const count = await this.receipts
        .createQueryBuilder('r')
        .where('r.user_id = :id', { id: user.id })
        .andWhere('r.receipt_date >= :weekAgo', { weekAgo })
        .getCount();
      await this.notifications.notify(user.id, {
        type: 'system',
        emoji: '🧾',
        title: 'Your week in receipts',
        body:
          count > 0
            ? `You logged ${count} receipt${count === 1 ? '' : 's'} this week. Open SpendSnap for the full recap.`
            : 'No receipts logged this week — snap one to get back on track.',
        data: { count },
        prefKey: 'weekly',
      });
      sent++;
    }
    this.logger.log(`weekly-summary: ${sent} sent`);
  }

  // ── Tips & offers — Mondays 10:00 ────────────────────────────────────────────
  @Cron('0 10 * * 1', { name: 'tips-and-offers' })
  async tipsAndOffers(): Promise<void> {
    const users = await this.usersWithDevices();
    const week = Math.floor(Date.now() / (7 * DAY_MS));
    const tip = TIPS[week % TIPS.length];
    let sent = 0;
    for (const user of users) {
      await this.notifications.notify(user.id, {
        type: 'system',
        emoji: '💡',
        title: 'Tip of the week',
        body: tip,
        prefKey: 'tips',
      });
      sent++;
    }
    this.logger.log(`tips-and-offers: ${sent} sent`);
  }

  // ── Product updates — manual broadcast (called from a release hook/admin) ─────
  /** Broadcast a product update to every user who has the toggle on. */
  async broadcastProductUpdate(title: string, body: string): Promise<number> {
    const users = await this.usersWithDevices();
    let sent = 0;
    for (const user of users) {
      await this.notifications.notify(user.id, {
        type: 'system',
        emoji: '✨',
        title,
        body,
        prefKey: 'product',
      });
      sent++;
    }
    this.logger.log(`product-update broadcast: ${sent} sent`);
    return sent;
  }
}
