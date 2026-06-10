import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Receipt } from '../receipts/entities/receipt.entity';
import { resolveFilingPeriod } from '../tax/relief-rules.config';
import { User } from '../users/entities/user.entity';

const CATEGORY_COLORS: Record<string, string> = {
  groceries: '#06B6D4',
  dining: '#22D3EE',
  transport: '#67E8F9',
  shopping: '#A5F3FC',
  sports: '#0E7490',
  bills: '#155E75',
  medical: '#10B981',
  books: '#6366F1',
  other: '#94A3B8',
};

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning,';
  if (h >= 12 && h < 17) return 'Good afternoon,';
  if (h >= 17 && h < 21) return 'Good evening,';
  return 'Good night,';
}

function daysUntil(date: Date): number {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function monthName(date: Date): string {
  return date.toLocaleString('en-MY', { month: 'long' });
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Receipt)
    private readonly receiptRepo: Repository<Receipt>,
  ) {}

  async getDashboard(user: User) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
    );

    const [
      currentMonthReceipts,
      prevMonthReceipts,
      recentReceipts,
      taxReceipts,
    ] = await Promise.all([
      // "This month" = receipts logged this month (by createdAt), so a receipt
      // you snap now always counts even if its printed date is last month.
      this.receiptRepo.find({
        where: { userId: user.id, createdAt: Between(monthStart, monthEnd) },
        order: { createdAt: 'DESC' },
      }),
      this.receiptRepo.find({
        where: {
          userId: user.id,
          createdAt: Between(prevMonthStart, prevMonthEnd),
        },
      }),
      this.receiptRepo.find({
        where: { userId: user.id },
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.receiptRepo.count({
        where: { userId: user.id, taxEligible: true },
      }),
    ]);

    // ── Spending totals (in the user's base currency) ─────────────────────────
    const baseAmt = (r: Receipt) => Number(r.baseAmount ?? r.amount);
    const currentTotal = currentMonthReceipts.reduce(
      (s, r) => s + baseAmt(r),
      0,
    );
    const prevTotal = prevMonthReceipts.reduce((s, r) => s + baseAmt(r), 0);
    const changeVsPrev =
      prevTotal === 0 ? 0 : ((currentTotal - prevTotal) / prevTotal) * 100;

    // Lifetime totals (since the user joined).
    const allTimeRaw = await this.receiptRepo
      .createQueryBuilder('r')
      .select('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(COALESCE(r.base_amount, r.amount)), 0)', 'total')
      .where('r.user_id = :id', { id: user.id })
      .getRawOne<{ count: string; total: string }>();
    const allTime = {
      total: Number(Number(allTimeRaw?.total ?? 0).toFixed(2)),
      receiptCount: Number(allTimeRaw?.count ?? 0),
    };

    // ── Highlights ───────────────────────────────────────────────────────────
    const highest = currentMonthReceipts.reduce<Receipt | null>(
      (max, r) => (!max || baseAmt(r) > baseAmt(max) ? r : max),
      null,
    );

    const merchantVisits = currentMonthReceipts.reduce<Record<string, number>>(
      (acc, r) => ({ ...acc, [r.merchant]: (acc[r.merchant] ?? 0) + 1 }),
      {},
    );
    const [mostVisitedMerchant, mostVisitedCount] = Object.entries(
      merchantVisits,
    ).sort(([, a], [, b]) => b - a)[0] ?? ['-', 0];

    const dayTotals = currentMonthReceipts.reduce<Record<number, number[]>>(
      (acc, r) => {
        const day = new Date(r.receiptDate).getDay();
        if (!acc[day]) acc[day] = [];
        acc[day].push(baseAmt(r));
        return acc;
      },
      {},
    );
    const dayAvgs = Object.entries(dayTotals).map(([d, amounts]) => ({
      day: d,
      avg: amounts.reduce((s, a) => s + a, 0) / amounts.length,
    }));
    const peakDay = dayAvgs.sort((a, b) => b.avg - a.avg)[0];
    const DAY_NAMES = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];

    // ── Categories ───────────────────────────────────────────────────────────
    const categoryTotals = currentMonthReceipts.reduce<Record<string, number>>(
      (acc, r) => ({
        ...acc,
        [r.category]: (acc[r.category] ?? 0) + baseAmt(r),
      }),
      {},
    );
    const categories = Object.entries(categoryTotals)
      .sort(([, a], [, b]) => b - a)
      .map(([name, amount]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        amount: Number(amount.toFixed(2)),
        pct: currentTotal > 0 ? Math.round((amount / currentTotal) * 100) : 0,
        color: CATEGORY_COLORS[name] ?? '#94A3B8',
      }));

    // ── e-Filing ─────────────────────────────────────────────────────────────
    // Single source of truth so the assessment year and the deadline can't
    // contradict (the old `getFullYear() - 1` + separate deadline drifted apart
    // after every Apr 30).
    const filing = resolveFilingPeriod(now);
    const efilingDeadline = new Date(`${filing.deadline}T00:00:00+08:00`);

    return {
      greeting: getGreeting(),
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        streakCount: user.streakCount,
        hasUnreadNotifications: user.hasUnreadNotifications,
        trialEndsAt: user.trialEndsAt,
      },
      spending: {
        month: monthName(now),
        year: now.getFullYear(),
        total: Number(currentTotal.toFixed(2)),
        currency: user.baseCurrency ?? 'MYR',
        receiptCount: currentMonthReceipts.length,
        changeVsPreviousMonthPct: Number(changeVsPrev.toFixed(1)),
        allTime,
      },
      highlights: {
        highest: highest
          ? {
              amount: Number(baseAmt(highest).toFixed(2)),
              merchant: highest.merchant,
              date: new Date(highest.receiptDate).toLocaleDateString('en-MY', {
                day: 'numeric',
                month: 'short',
              }),
            }
          : null,
        mostVisited: {
          merchant: mostVisitedMerchant,
          visits: mostVisitedCount,
        },
        peakDay: peakDay
          ? {
              day: DAY_NAMES[Number(peakDay.day)] + 's',
              avgAmount: Number(peakDay.avg.toFixed(2)),
            }
          : null,
      },
      categories,
      recentReceipts: recentReceipts.map((r) => ({
        id: r.id,
        merchant: r.merchant,
        category: r.category,
        amount: Number(r.amount),
        currency: r.currency,
        baseAmount: Number(r.baseAmount ?? r.amount),
        baseCurrency: r.baseCurrency ?? user.baseCurrency ?? 'MYR',
        date: r.receiptDate,
        taxEligible: r.taxEligible,
        tags: r.tags ?? [],
        imageUrl: r.imageUrl ?? null,
      })),
      efiling: {
        assessmentYear: `YA ${filing.ya}`,
        deadline: filing.deadline,
        daysLeft: daysUntil(efilingDeadline),
        eligibleReceiptCount: taxReceipts,
      },
    };
  }
}
