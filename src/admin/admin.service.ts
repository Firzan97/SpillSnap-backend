/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-enum-comparison */
// Admin metrics use raw SQL via repo.query(), which TypeORM types as `any`. The
// row shapes are asserted at the access site (toInt(...) / `as string`), so the
// unsafe-any rules are disabled for this file rather than littered per-line.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiUsage } from '../billing/entities/ai-usage.entity';
import {
  BillingInterval,
  Subscription,
  SubscriptionStatus,
} from '../billing/entities/subscription.entity';
import {
  PRICING_PLANS,
  PRICING_CONFIG_KEY,
  pricingDefault,
  type PricingPayload,
  DEFAULT_LIMITS,
  LIMITS_CONFIG_KEY,
  type AppLimits,
} from '../billing/plans.config';
import { PlanId } from '../billing/entities/subscription.entity';
import { Receipt } from '../receipts/entities/receipt.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { AppConfigService } from '../config/app-config.service';

/** A row in the users list page. */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: 'pro' | 'trial' | 'free'; // resolved entitlement, not just role
  status: string | null; // subscription status if any
  billingInterval: string | null;
  country: string;
  devices: string[]; // platforms from registered push tokens: ios | android
  createdAt: string;
  trialEndsAt: string | null;
}

/** Global device split (distinct users per platform; a user may have both). */
export interface DeviceSummary {
  ios: number;
  android: number;
  both: number;
  noDevice: number;
}

/** Response for the users list page. */
export interface UsersResponse {
  rows: UserRow[];
  devices: DeviceSummary;
}

/** A {label,value} row used by the dashboard's bars and tables. */
export interface Count {
  label: string;
  value: number;
}
/** A daily time-series point. */
export interface DailyPoint {
  day: string; // YYYY-MM-DD
  value: number;
}

const toInt = (v: unknown): number => Number(v ?? 0) || 0;
const toNum = (v: unknown): number => Number(v ?? 0) || 0;

// Pro plan prices (MYR), read from the public catalog so the dashboard MRR
// tracks the same numbers the Pricing page shows.
const PRO = PRICING_PLANS.find((p) => p.id === PlanId.PRO);
const PRO_MONTHLY =
  PRO?.prices.find((p) => p.interval === BillingInterval.MONTHLY)?.amount ?? 0;
const PRO_ANNUAL =
  PRO?.prices.find((p) => p.interval === BillingInterval.ANNUAL)?.amount ?? 0;

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Receipt) private readonly receipts: Repository<Receipt>,
    @InjectRepository(Subscription)
    private readonly subs: Repository<Subscription>,
    @InjectRepository(AiUsage) private readonly aiUsage: Repository<AiUsage>,
    private readonly appConfig: AppConfigService,
  ) {}

  // ── Pricing (admin-editable) ────────────────────────────────────────────────
  /** Effective pricing + the code default + whether an override is active. */
  async getPricing(): Promise<{
    effective: PricingPayload;
    default: PricingPayload;
    overridden: boolean;
  }> {
    const def = pricingDefault();
    const [effective, overridden] = await Promise.all([
      this.appConfig.get<PricingPayload>(PRICING_CONFIG_KEY, def),
      this.appConfig.isOverridden(PRICING_CONFIG_KEY),
    ]);
    return { effective, default: def, overridden };
  }

  /** Validate + persist an admin-edited pricing payload. */
  async setPricing(payload: PricingPayload): Promise<PricingPayload> {
    this.validatePricing(payload);
    return this.appConfig.set<PricingPayload>(PRICING_CONFIG_KEY, payload);
  }

  /** Drop the override → revert to the shipped default. */
  async resetPricing(): Promise<PricingPayload> {
    await this.appConfig.reset(PRICING_CONFIG_KEY);
    return pricingDefault();
  }

  // ── Plan limits (admin-editable) ────────────────────────────────────────────
  async getLimits(): Promise<{
    effective: AppLimits;
    default: AppLimits;
    overridden: boolean;
  }> {
    const [effective, overridden] = await Promise.all([
      this.appConfig.get<AppLimits>(LIMITS_CONFIG_KEY, DEFAULT_LIMITS),
      this.appConfig.isOverridden(LIMITS_CONFIG_KEY),
    ]);
    return { effective, default: DEFAULT_LIMITS, overridden };
  }

  async setLimits(payload: AppLimits): Promise<AppLimits> {
    const freeMonthlyScans = Number(payload?.freeMonthlyScans);
    const trialDays = Number(payload?.trialDays);
    if (!Number.isInteger(freeMonthlyScans) || freeMonthlyScans < 0) {
      throw new Error('freeMonthlyScans must be a non-negative integer');
    }
    if (!Number.isInteger(trialDays) || trialDays < 0) {
      throw new Error('trialDays must be a non-negative integer');
    }
    return this.appConfig.set<AppLimits>(LIMITS_CONFIG_KEY, {
      freeMonthlyScans,
      trialDays,
    });
  }

  async resetLimits(): Promise<AppLimits> {
    await this.appConfig.reset(LIMITS_CONFIG_KEY);
    return DEFAULT_LIMITS;
  }

  private validatePricing(p: unknown): asserts p is PricingPayload {
    const obj = p as Partial<PricingPayload>;
    if (!obj || !Array.isArray(obj.plans) || obj.plans.length === 0) {
      throw new Error('pricing.plans must be a non-empty array');
    }
    for (const plan of obj.plans) {
      if (!plan?.id || !plan?.name || !Array.isArray(plan?.prices)) {
        throw new Error('each plan needs id, name and a prices array');
      }
      for (const pr of plan.prices) {
        if (
          typeof pr?.amount !== 'number' ||
          typeof pr?.perMonth !== 'number' ||
          !pr?.interval
        ) {
          throw new Error(
            `plan "${plan.id}" has a price missing interval/amount/perMonth`,
          );
        }
      }
    }
    if (typeof obj.currency !== 'string' || typeof obj.note !== 'string') {
      throw new Error('pricing needs currency + note strings');
    }
  }

  /** Single payload backing the whole admin dashboard. */
  async metrics() {
    const [
      users,
      subscriptions,
      receipts,
      tokens,
      engagement,
      revenue,
      analytics,
    ] = await Promise.all([
      this.userMetrics(),
      this.subscriptionMetrics(),
      this.receiptMetrics(),
      this.tokenMetrics(),
      this.engagementMetrics(),
      this.revenueMetrics(),
      this.analyticsMetrics(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      users,
      subscriptions,
      receipts,
      tokens,
      analytics,
      engagement,
      revenue,
    };
  }

  // ── Users / signups ──────────────────────────────────────────────────────
  private async userMetrics() {
    const total = await this.users.count();

    const byRole = await this.groupCount(
      `SELECT role AS label, COUNT(*)::int AS value FROM users GROUP BY role`,
    );
    const byAuthProvider = await this.groupCount(
      `SELECT auth_provider AS label, COUNT(*)::int AS value FROM users GROUP BY auth_provider`,
    );
    const byCountry = await this.groupCount(
      `SELECT country AS label, COUNT(*)::int AS value FROM users GROUP BY country ORDER BY value DESC LIMIT 10`,
    );

    // Free-trial users = trial window still open right now.
    const onTrial = await this.users
      .createQueryBuilder('u')
      .where('u.trial_ends_at > now()')
      .getCount();

    const signupsLast30d = await this.daily(
      `SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS value
       FROM users WHERE created_at >= now() - interval '30 days'
       GROUP BY day ORDER BY day`,
    );

    const newLast7d = await this.users
      .createQueryBuilder('u')
      .where("u.created_at >= now() - interval '7 days'")
      .getCount();

    return {
      total,
      onTrial,
      newLast7d,
      byRole,
      byAuthProvider,
      byCountry,
      signupsLast30d,
    };
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────
  private async subscriptionMetrics() {
    const byStatus = await this.groupCount(
      `SELECT status AS label, COUNT(*)::int AS value FROM subscriptions GROUP BY status`,
    );
    // Billing interval among currently paying (active) subs.
    const byInterval = await this.groupCount(
      `SELECT billing_interval AS label, COUNT(*)::int AS value
       FROM subscriptions
       WHERE status = '${SubscriptionStatus.ACTIVE}' AND billing_interval IS NOT NULL
       GROUP BY billing_interval`,
    );

    const active = await this.subs.count({
      where: { status: SubscriptionStatus.ACTIVE },
    });
    const trialing = await this.subs.count({
      where: { status: SubscriptionStatus.TRIALING },
    });
    const pastDue = await this.subs.count({
      where: { status: SubscriptionStatus.PAST_DUE },
    });
    const cancelPending = await this.subs.count({
      where: { cancelAtPeriodEnd: true },
    });

    // Rough trial→paid conversion: active out of everyone who is or was past
    // the trial decision point (active + trialing).
    const conversionRate =
      active + trialing > 0
        ? Number(((active / (active + trialing)) * 100).toFixed(1))
        : 0;

    return {
      byStatus,
      byInterval,
      active,
      trialing,
      pastDue,
      cancelPending,
      conversionRate,
    };
  }

  // ── Receipts ────────────────────────────────────────────────────────────────
  private async receiptMetrics() {
    const total = await this.receipts.count();
    const bySource = await this.groupCount(
      `SELECT source AS label, COUNT(*)::int AS value FROM receipts GROUP BY source`,
    );
    const byStatus = await this.groupCount(
      `SELECT status AS label, COUNT(*)::int AS value FROM receipts GROUP BY status`,
    );
    const byCategory = await this.groupCount(
      `SELECT category AS label, COUNT(*)::int AS value FROM receipts GROUP BY category ORDER BY value DESC`,
    );
    const taxEligible = await this.receipts.count({
      where: { taxEligible: true },
    });
    const last30d = await this.daily(
      `SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS value
       FROM receipts WHERE created_at >= now() - interval '30 days'
       GROUP BY day ORDER BY day`,
    );
    return { total, taxEligible, bySource, byStatus, byCategory, last30d };
  }

  // ── AI tokens / cost ──────────────────────────────────────────────────────
  private async tokenMetrics() {
    const totalsRow = await this.aiUsage
      .createQueryBuilder('a')
      .select('COALESCE(SUM(a.input_tokens),0)', 'input')
      .addSelect('COALESCE(SUM(a.output_tokens),0)', 'output')
      .addSelect('COALESCE(SUM(a.cache_read_tokens),0)', 'cacheRead')
      .addSelect('COALESCE(SUM(a.cost_usd),0)', 'cost')
      .addSelect('COUNT(*)', 'calls')
      .getRawOne<{
        input: string;
        output: string;
        cacheRead: string;
        cost: string;
        calls: string;
      }>();

    const inputTokens = toInt(totalsRow?.input);
    const outputTokens = toInt(totalsRow?.output);
    const calls = toInt(totalsRow?.calls);
    const costUsd = Number(toNum(totalsRow?.cost).toFixed(4));

    const byModel = await this.groupCount(
      `SELECT model AS label, COUNT(*)::int AS value FROM ai_usage GROUP BY model ORDER BY value DESC`,
    );
    const byChannel = await this.groupCount(
      `SELECT channel AS label, COUNT(*)::int AS value FROM ai_usage GROUP BY channel`,
    );

    const last30d = await this.daily(
      `SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(input_tokens + output_tokens),0)::int AS value
       FROM ai_usage WHERE created_at >= now() - interval '30 days'
       GROUP BY day ORDER BY day`,
    );
    const costLast30d = await this.dailyFloat(
      `SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(cost_usd),0) AS value
       FROM ai_usage WHERE created_at >= now() - interval '30 days'
       GROUP BY day ORDER BY day`,
    );

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd,
      calls,
      byModel,
      byChannel,
      last30d,
      costLast30d,
    };
  }

  // ── Engagement ──────────────────────────────────────────────────────────────
  private async engagementMetrics() {
    const dau = await this.distinctReceiptUsers('1 day');
    const wau = await this.distinctReceiptUsers('7 days');
    const mau = await this.distinctReceiptUsers('30 days');
    const stickiness = mau > 0 ? Number(((dau / mau) * 100).toFixed(1)) : 0;

    // Activation: share of users who have saved at least one receipt.
    const activatedRow = await this.users.query(
      `SELECT COUNT(DISTINCT r.user_id)::int AS value FROM receipts r`,
    );
    const activatedUsers = toInt(activatedRow?.[0]?.value);
    const totalUsers = await this.users.count();
    const activationRate =
      totalUsers > 0
        ? Number(((activatedUsers / totalUsers) * 100).toFixed(1))
        : 0;

    return { dau, wau, mau, stickiness, activatedUsers, activationRate };
  }

  // ── Revenue (MRR/ARR/ARPU) ──────────────────────────────────────────────────
  private async revenueMetrics() {
    const monthly = await this.subs.count({
      where: {
        status: SubscriptionStatus.ACTIVE,
        billingInterval: BillingInterval.MONTHLY,
      },
    });
    const annual = await this.subs.count({
      where: {
        status: SubscriptionStatus.ACTIVE,
        billingInterval: BillingInterval.ANNUAL,
      },
    });

    // Normalise both intervals to a monthly run-rate (MYR). Annual price is a
    // yearly charge, so divide by 12.
    const mrr = monthly * PRO_MONTHLY + annual * (PRO_ANNUAL / 12);
    const arr = mrr * 12;
    const payingUsers = monthly + annual;
    const arpu = payingUsers > 0 ? mrr / payingUsers : 0;

    return {
      currency: 'MYR',
      mrr: Number(mrr.toFixed(2)),
      arr: Number(arr.toFixed(2)),
      arpu: Number(arpu.toFixed(2)),
      payingUsers,
    };
  }

  // ── Analytics ─────────────────────────────────────────────────────────────
  /**
   * Receipt-activity analytics. Days are bucketed in Asia/Kuala_Lumpur (the
   * app's timezone) so "today" and per-day numbers match what users see.
   */
  private async analyticsMetrics() {
    const TZ = 'Asia/Kuala_Lumpur';
    const klDate = `(created_at AT TIME ZONE '${TZ}')::date`;

    const total = await this.receipts.count();

    // distinct active days + distinct users with receipts
    const aggRow = await this.receipts.query(
      `SELECT COUNT(DISTINCT ${klDate})::int AS days,
              COUNT(DISTINCT user_id)::int AS users
       FROM receipts`,
    );
    const activeDays = toInt(aggRow?.[0]?.days);
    const usersWithReceipts = toInt(aggRow?.[0]?.users);

    // per-day counts → highest / lowest active day
    const perDay = await this.receipts.query(
      `SELECT to_char(${klDate}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
       FROM receipts GROUP BY 1 ORDER BY count DESC`,
    );
    const rows = perDay as { day: string; count: number }[];
    const highestDay = rows[0] ?? null;
    const lowestDay = rows.length ? rows[rows.length - 1] : null;

    // most visited place (non-empty location mode)
    const placeRow = await this.receipts.query(
      `SELECT location AS label, COUNT(*)::int AS value
       FROM receipts WHERE location IS NOT NULL AND location <> ''
       GROUP BY location ORDER BY value DESC LIMIT 1`,
    );
    const mostVisitedPlace = placeRow?.[0]
      ? { label: placeRow[0].label as string, value: toInt(placeRow[0].value) }
      : null;

    // peak weekday (0=Sun … 6=Sat in KL)
    const dowRow = await this.receipts.query(
      `SELECT EXTRACT(DOW FROM (created_at AT TIME ZONE '${TZ}'))::int AS dow,
              COUNT(*)::int AS value
       FROM receipts GROUP BY 1 ORDER BY value DESC LIMIT 1`,
    );
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const peakWeekday = dowRow?.[0]
      ? {
          label: DOW[toInt(dowRow[0].dow)] ?? '—',
          value: toInt(dowRow[0].value),
        }
      : null;

    // active today (KL) vs not
    const activeRow = await this.receipts.query(
      `SELECT COUNT(DISTINCT user_id)::int AS value FROM receipts
       WHERE ${klDate} = (now() AT TIME ZONE '${TZ}')::date`,
    );
    const activeToday = toInt(activeRow?.[0]?.value);
    const totalUsers = await this.users.count();
    const inactiveToday = Math.max(0, totalUsers - activeToday);

    const round1 = (n: number) => Number(n.toFixed(1));
    return {
      totalReceipts: total,
      activeDays,
      avgPerDay: activeDays ? round1(total / activeDays) : 0,
      avgPerUser: usersWithReceipts ? round1(total / usersWithReceipts) : 0,
      avgPerDayPerUser:
        activeDays && usersWithReceipts
          ? round1(total / (activeDays * usersWithReceipts))
          : 0,
      highestDay,
      lowestDay,
      mostVisitedPlace,
      peakWeekday,
      activeToday,
      inactiveToday,
    };
  }

  // ── Users list ──────────────────────────────────────────────────────────────
  /** Recent registrations (with plan + devices) plus the global device split. */
  async usersPage(limit = 50): Promise<UsersResponse> {
    const [rows, devices] = await Promise.all([
      this.recentUsers(limit),
      this.deviceSummary(),
    ]);
    return { rows, devices };
  }

  /** Distinct users per push-token platform, across ALL users (not paginated). */
  private async deviceSummary(): Promise<DeviceSummary> {
    const row = await this.users.query(
      `WITH per_user AS (
         SELECT user_id,
                bool_or(platform = 'ios') AS has_ios,
                bool_or(platform = 'android') AS has_android
         FROM push_tokens GROUP BY user_id
       )
       SELECT
         COUNT(*) FILTER (WHERE has_ios)::int AS ios,
         COUNT(*) FILTER (WHERE has_android)::int AS android,
         COUNT(*) FILTER (WHERE has_ios AND has_android)::int AS both
       FROM per_user`,
    );
    const ios = toInt(row?.[0]?.ios);
    const android = toInt(row?.[0]?.android);
    const both = toInt(row?.[0]?.both);
    const withDeviceRow = await this.users.query(
      `SELECT COUNT(DISTINCT user_id)::int AS value FROM push_tokens`,
    );
    const totalUsers = await this.users.count();
    const noDevice = Math.max(0, totalUsers - toInt(withDeviceRow?.[0]?.value));
    return { ios, android, both, noDevice };
  }

  /** Most-recent registrations with their resolved plan (pro/trial/free). */
  async recentUsers(limit = 50): Promise<UserRow[]> {
    const lim = Math.min(Math.max(1, limit), 200);
    const rows = await this.users.query(
      `SELECT u.id, u.email, u.name, u.role, u.country,
              u.created_at, u.trial_ends_at,
              s.status AS sub_status, s.billing_interval, s.current_period_end,
              d.platforms
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT p.platform) AS platforms
         FROM push_tokens p WHERE p.user_id = u.id::text
       ) d ON true
       ORDER BY u.created_at DESC
       LIMIT $1`,
      [lim],
    );
    const now = Date.now();
    return (rows as Record<string, unknown>[]).map((r) => {
      const trialEnds = r.trial_ends_at
        ? new Date(r.trial_ends_at as string)
        : null;
      const periodEnd = r.current_period_end
        ? new Date(r.current_period_end as string)
        : null;
      const status = (r.sub_status as string) ?? null;
      const paidActive =
        (status === SubscriptionStatus.ACTIVE ||
          status === SubscriptionStatus.TRIALING) &&
        (!periodEnd || periodEnd.getTime() > now);
      const trialActive = !!trialEnds && trialEnds.getTime() > now;
      const plan: UserRow['plan'] = paidActive
        ? 'pro'
        : trialActive
          ? 'trial'
          : 'free';
      return {
        id: r.id as string,
        email: r.email as string,
        name: (r.name as string) ?? '',
        role: r.role as string,
        plan,
        status,
        billingInterval: (r.billing_interval as string) ?? null,
        country: (r.country as string) ?? '',
        devices: ((r.platforms as string[] | null) ?? []).filter(Boolean),
        createdAt: new Date(r.created_at as string).toISOString(),
        trialEndsAt: trialEnds ? trialEnds.toISOString() : null,
      };
    });
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  /**
   * DESTRUCTIVE. Wipes all non-admin users and their data for a fresh start,
   * plus the AI-usage ledger so token stats reset to zero. Admin accounts are
   * preserved so the caller keeps access. Runs in one transaction.
   */
  async reset(): Promise<{
    deletedUsers: number;
    deletedReceipts: number;
    deletedSubscriptions: number;
    clearedAiUsage: number;
  }> {
    return this.users.manager.transaction(async (em) => {
      const victims: { id: string }[] = await em.query(
        `SELECT id FROM users WHERE role <> $1`,
        [UserRole.ADMIN],
      );
      const ids = victims.map((v) => v.id);

      const count = async (
        sql: string,
        params: unknown[] = [],
      ): Promise<number> => {
        const r = await em.query(sql, params);
        return Number(r?.[0]?.value ?? 0);
      };

      if (ids.length === 0) {
        const cleared = await count(
          `SELECT COUNT(*)::int AS value FROM ai_usage`,
        );
        await em.query(`DELETE FROM ai_usage`);
        return {
          deletedUsers: 0,
          deletedReceipts: 0,
          deletedSubscriptions: 0,
          clearedAiUsage: cleared,
        };
      }

      const deletedReceipts = await count(
        `SELECT COUNT(*)::int AS value FROM receipts WHERE user_id = ANY($1)`,
        [ids],
      );
      const deletedSubscriptions = await count(
        `SELECT COUNT(*)::int AS value FROM subscriptions WHERE user_id = ANY($1)`,
        [ids],
      );
      const clearedAiUsage = await count(
        `SELECT COUNT(*)::int AS value FROM ai_usage`,
      );

      // Explicit child deletes first (don't rely solely on FK cascade).
      await em.query(`DELETE FROM ai_usage`); // full reset of token stats
      await em.query(`DELETE FROM receipts WHERE user_id = ANY($1)`, [ids]);
      await em.query(`DELETE FROM subscriptions WHERE user_id = ANY($1)`, [
        ids,
      ]);
      await em.query(`DELETE FROM daily_usage WHERE user_id = ANY($1)`, [ids]);
      await em.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);

      return {
        deletedUsers: ids.length,
        deletedReceipts,
        deletedSubscriptions,
        clearedAiUsage,
      };
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  private async distinctReceiptUsers(interval: string): Promise<number> {
    const row = await this.receipts.query(
      `SELECT COUNT(DISTINCT user_id)::int AS value FROM receipts
       WHERE created_at >= now() - interval '${interval}'`,
    );
    return toInt(row?.[0]?.value);
  }

  private async groupCount(sql: string): Promise<Count[]> {
    const rows = await this.users.query(sql);
    return (rows as { label: string; value: unknown }[]).map((r) => ({
      label: r.label ?? 'unknown',
      value: toInt(r.value),
    }));
  }

  private async daily(sql: string): Promise<DailyPoint[]> {
    const rows = await this.users.query(sql);
    return (rows as { day: string; value: unknown }[]).map((r) => ({
      day: r.day,
      value: toInt(r.value),
    }));
  }

  private async dailyFloat(sql: string): Promise<DailyPoint[]> {
    const rows = await this.users.query(sql);
    return (rows as { day: string; value: unknown }[]).map((r) => ({
      day: r.day,
      value: Number(toNum(r.value).toFixed(4)),
    }));
  }
}
