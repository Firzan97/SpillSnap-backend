import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Receipt } from '../receipts/entities/receipt.entity';
import { User } from '../users/entities/user.entity';

/** Shared palette so the app and the charts agree on a colour per category. */
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

export type AnalyticsRange = '6m' | '12m' | 'ya' | 'all';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const round2 = (n: number) => Number(n.toFixed(2));
const startOfMonth = (d: Date, monthsBack = 0) =>
  new Date(d.getFullYear(), d.getMonth() - monthsBack, 1);

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Receipt)
    private readonly receiptRepo: Repository<Receipt>,
  ) {}

  async getAnalytics(user: User, range: AnalyticsRange = '12m') {
    const now = new Date();
    const baseAmt = (r: Receipt) => Number(r.baseAmount ?? r.amount);
    const currency = user.baseCurrency ?? 'MYR';

    // Resolve the time window. `start === null` means all-time.
    const start = this.windowStart(range, now);

    // One fetch drives every chart - volume is modest, so we aggregate in JS.
    const receipts = await this.receiptRepo.find({
      where: start
        ? { userId: user.id, receiptDate: MoreThanOrEqual(start) }
        : { userId: user.id },
      order: { receiptDate: 'ASC' },
    });

    const spend = receipts.reduce((s, r) => s + baseAmt(r), 0);
    const receiptCount = receipts.length;
    const avgPerReceipt = receiptCount ? spend / receiptCount : 0;

    // ── Previous comparable window (for the headline % change) ────────────────
    let vsPrevPct: number | null = null;
    if (start) {
      const span = now.getTime() - start.getTime();
      const prevStart = new Date(start.getTime() - span);
      const prev = await this.receiptRepo.find({
        where: {
          userId: user.id,
          receiptDate: MoreThanOrEqual(prevStart),
        },
      });
      const prevSpend = prev
        .filter((r) => new Date(r.receiptDate) < start)
        .reduce((s, r) => s + baseAmt(r), 0);
      vsPrevPct =
        prevSpend === 0 ? null : round2(((spend - prevSpend) / prevSpend) * 100);
    }

    // ── Monthly trend (ordered, zero-filled) ──────────────────────────────────
    const firstDate = receipts[0]
      ? new Date(receipts[0].receiptDate)
      : now;
    const trendStart = start ?? startOfMonth(firstDate);
    const monthlyTrend = this.buildMonthlyTrend(receipts, trendStart, now, baseAmt);

    // ── Categories ────────────────────────────────────────────────────────────
    const catTotals = new Map<string, { amount: number; count: number }>();
    for (const r of receipts) {
      const cur = catTotals.get(r.category) ?? { amount: 0, count: 0 };
      cur.amount += baseAmt(r);
      cur.count += 1;
      catTotals.set(r.category, cur);
    }
    const categories = [...catTotals.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([key, v]) => ({
        key,
        label: cap(key),
        amount: round2(v.amount),
        count: v.count,
        pct: spend > 0 ? Math.round((v.amount / spend) * 100) : 0,
        color: CATEGORY_COLORS[key] ?? '#94A3B8',
      }));

    // ── Top merchants ─────────────────────────────────────────────────────────
    const merchantTotals = new Map<string, { amount: number; visits: number }>();
    for (const r of receipts) {
      const cur = merchantTotals.get(r.merchant) ?? { amount: 0, visits: 0 };
      cur.amount += baseAmt(r);
      cur.visits += 1;
      merchantTotals.set(r.merchant, cur);
    }
    const topMerchants = [...merchantTotals.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 6)
      .map(([merchant, v]) => ({
        merchant,
        amount: round2(v.amount),
        visits: v.visits,
      }));

    // ── Spend by weekday (Mon-Sun) ────────────────────────────────────────────
    const weekdayTotals = Array.from({ length: 7 }, () => ({
      total: 0,
      count: 0,
    }));
    for (const r of receipts) {
      // JS getDay(): 0=Sun..6=Sat -> shift to 0=Mon..6=Sun.
      const idx = (new Date(r.receiptDate).getDay() + 6) % 7;
      weekdayTotals[idx].total += baseAmt(r);
      weekdayTotals[idx].count += 1;
    }
    const weekday = weekdayTotals.map((w, i) => ({
      day: WEEKDAY_LABELS[i],
      total: round2(w.total),
      count: w.count,
    }));

    // ── Tax-eligible split ────────────────────────────────────────────────────
    const eligible = receipts.filter((r) => r.taxEligible);
    const eligibleAmount = eligible.reduce((s, r) => s + baseAmt(r), 0);
    const taxEligible = {
      eligibleAmount: round2(eligibleAmount),
      eligibleCount: eligible.length,
      totalCount: receiptCount,
      pct: receiptCount ? Math.round((eligible.length / receiptCount) * 100) : 0,
    };

    // ── Highlights ────────────────────────────────────────────────────────────
    const biggest = receipts.reduce<Receipt | null>(
      (max, r) => (!max || baseAmt(r) > baseAmt(max) ? r : max),
      null,
    );
    const busiestWeekday = [...weekday].sort((a, b) => b.total - a.total)[0];

    return {
      range,
      currency,
      generatedAt: now.toISOString(),
      totals: {
        spend: round2(spend),
        receiptCount,
        avgPerReceipt: round2(avgPerReceipt),
        vsPrevPct,
      },
      monthlyTrend,
      categories,
      topMerchants,
      weekday,
      taxEligible,
      highlights: {
        biggest: biggest
          ? {
              merchant: biggest.merchant,
              amount: round2(baseAmt(biggest)),
              date: biggest.receiptDate,
              category: biggest.category,
            }
          : null,
        topCategory: categories[0] ?? null,
        topMerchant: topMerchants[0] ?? null,
        busiestWeekday: busiestWeekday?.total ? busiestWeekday : null,
      },
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  private windowStart(range: AnalyticsRange, now: Date): Date | null {
    switch (range) {
      case '6m':
        return startOfMonth(now, 5);
      case '12m':
        return startOfMonth(now, 11);
      case 'ya':
        return new Date(now.getFullYear(), 0, 1);
      case 'all':
        return null;
    }
  }

  /** Ordered list of every month from `from` to now, each with its summed spend. */
  private buildMonthlyTrend(
    receipts: Receipt[],
    from: Date,
    now: Date,
    baseAmt: (r: Receipt) => number,
  ) {
    const totals = new Map<string, number>();
    for (const r of receipts) {
      const d = new Date(r.receiptDate);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      totals.set(key, (totals.get(key) ?? 0) + baseAmt(r));
    }

    const out: { month: string; year: number; total: number }[] = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    // Cap at 24 points so an all-time view never produces a runaway array.
    let guard = 0;
    while (
      (cursor.getFullYear() < now.getFullYear() ||
        (cursor.getFullYear() === now.getFullYear() &&
          cursor.getMonth() <= now.getMonth())) &&
      guard < 24
    ) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      out.push({
        month: MONTH_LABELS[cursor.getMonth()],
        year: cursor.getFullYear(),
        total: round2(totals.get(key) ?? 0),
      });
      cursor.setMonth(cursor.getMonth() + 1);
      guard += 1;
    }
    return out;
  }
}
