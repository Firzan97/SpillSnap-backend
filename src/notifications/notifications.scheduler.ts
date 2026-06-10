import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Receipt } from '../receipts/entities/receipt.entity';
import { User } from '../users/entities/user.entity';
import { PushToken } from '../push/entities/push-token.entity';
import { NotificationsService } from './notifications.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// All reminder crons fire on Malaysia local time - without this they run in the
// server's timezone (UTC in prod), so "20:00" would land at ~4 AM for users.
const TIMEZONE = 'Asia/Kuala_Lumpur';

// A small rotating pool of tips, indexed by ISO week so everyone sees the same
// one and it changes weekly.
const TIPS = [
  'Snap receipts the moment you pay - it only takes a second and keeps your streak alive.',
  'Tag receipts with #tax as you go to make e-Filing season effortless.',
  'Pro unlocks WhatsApp receipt upload - forward a photo and we file it for you.',
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

  // ── Daily snap reminder - 20:00 every day (Malaysia time) ────────────────────
  @Cron('0 20 * * *', { name: 'daily-snap-reminder', timeZone: TIMEZONE })
  async dailySnapReminder(): Promise<void> {
    const users = await this.usersWithDevices();
    let sent = 0;
    for (const user of users) {
      if (this.snappedToday(user)) continue;
      // Skip brand-new users who have never snapped - nothing to remind about.
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

  // ── Streak at risk - 21:00 every day (Malaysia time) ─────────────────────────
  @Cron('0 21 * * *', { name: 'streak-at-risk', timeZone: TIMEZONE })
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

  // ── Weekly summary - Sundays 18:00 (Malaysia time) ───────────────────────────
  @Cron('0 18 * * 0', { name: 'weekly-summary', timeZone: TIMEZONE })
  async weeklySummary(): Promise<void> {
    const users = await this.usersWithDevices();
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);
    let sent = 0;
    for (const user of users) {
      const rows = await this.receipts
        .createQueryBuilder('r')
        .select(['r.category AS category', 'r.amount AS amount', 'r.base_amount AS base_amount'])
        .where('r.user_id = :id', { id: user.id })
        .andWhere('r.receipt_date >= :weekAgo', { weekAgo })
        .getRawMany<{ category: string; amount: string; base_amount: string | null }>();

      const count = rows.length;
      const currency = user.baseCurrency ?? 'MYR';
      const prefix = currency === 'MYR' ? 'RM' : `${currency} `;

      // Total spend (base currency) + the category the user spent most on.
      let total = 0;
      const byCategory = new Map<string, number>();
      for (const r of rows) {
        const amt = Number(r.base_amount ?? r.amount);
        total += amt;
        byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + amt);
      }
      const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const topLabel = topCategory
        ? topCategory.charAt(0).toUpperCase() + topCategory.slice(1)
        : null;
      const spend = `${prefix}${total.toLocaleString('en-MY', { maximumFractionDigits: 0 })}`;

      const body =
        count > 0
          ? `You logged ${count} receipt${count === 1 ? '' : 's'} worth ${spend} this week` +
            (topLabel ? `, mostly on ${topLabel}.` : '.') +
            ' Open SpillSnap for the full recap.'
          : 'No receipts logged this week - snap one to get back on track.';

      await this.notifications.notify(user.id, {
        type: 'system',
        emoji: '🧾',
        title: 'Your week in receipts',
        body,
        data: { count, total: Number(total.toFixed(2)), currency, topCategory: topCategory ?? null },
        prefKey: 'weekly',
      });
      sent++;
    }
    this.logger.log(`weekly-summary: ${sent} sent`);
  }

  // ── Tips & offers - Mondays 10:00 (Malaysia time) ────────────────────────────
  @Cron('0 10 * * 1', { name: 'tips-and-offers', timeZone: TIMEZONE })
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

  // ── Product updates - manual broadcast (called from a release hook/admin) ─────
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
