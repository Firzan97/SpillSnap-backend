import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
} from '../billing/entities/subscription.entity';
import { Receipt, ReceiptStatus } from '../receipts/entities/receipt.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { PublicStatsResponseDto } from './dto/public-stats-response.dto';

// Anonymized-handle palette mirrors LeaderboardService so podium colors match.
const AVATAR_COLORS = [
  '#F472B6',
  '#A78BFA',
  '#06B6D4',
  '#FB923C',
  '#34D399',
  '#60A5FA',
  '#FBBF24',
  '#F87171',
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++)
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Public handle: first name + last initial ("Priya Ramasamy" -> "Priya R.").
function publicHandle(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Anonymous';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

@Injectable()
export class PublicStatsService {
  private readonly logger = new Logger(PublicStatsService.name);

  // Marketing counters are vanity aggregates over the whole table — heavy and
  // not time-sensitive (the UI says "updated every hour"). Cache one shared
  // snapshot in memory so N visitors cost 1 query/hour, not N queries/load.
  private cache: PublicStatsResponseDto | null = null;
  private cacheExpiresAt = 0;
  private readonly ttlMs: number;

  // Coalesce concurrent misses so a cold cache can't fan out into N queries.
  private inFlight: Promise<PublicStatsResponseDto> | null = null;

  constructor(
    @InjectRepository(Receipt)
    private readonly receiptRepo: Repository<Receipt>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    config: ConfigService,
  ) {
    this.ttlMs =
      config.get<number>('PUBLIC_STATS_TTL_MS') ?? 60 * 60 * 1000; // 1h
  }

  async getStats(): Promise<PublicStatsResponseDto> {
    if (this.cache && Date.now() < this.cacheExpiresAt) return this.cache;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.compute()
      .then((stats) => {
        this.cache = stats;
        this.cacheExpiresAt = Date.now() + this.ttlMs;
        return stats;
      })
      .catch((err) => {
        // On failure serve the stale snapshot if we have one — a marketing
        // counter going slightly stale beats a 500 on the landing page.
        this.logger.error('Failed to compute public stats', err as Error);
        if (this.cache) return this.cache;
        throw err;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  private async compute(): Promise<PublicStatsResponseDto> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      receiptsTotal,
      receiptsToday,
      activeMembers,
      activeThisWeek,
      freeUsers,
      proSubscribers,
      proThisMonth,
      taxSavings,
      taxSavingsThisMonth,
      topSnappers,
    ] = await Promise.all([
      this.receiptRepo.count({ where: { status: ReceiptStatus.CONFIRMED } }),
      this.receiptRepo
        .createQueryBuilder('r')
        .where('r.status = :status', { status: ReceiptStatus.CONFIRMED })
        .andWhere('r.created_at >= :dayAgo', { dayAgo })
        .getCount(),
      // "Active" = snapped at least once in the trailing 30 days.
      this.userRepo
        .createQueryBuilder('u')
        .where('u.last_snap_at >= :monthAgo', {
          monthAgo: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        })
        .getCount(),
      this.userRepo
        .createQueryBuilder('u')
        .where('u.created_at >= :weekAgo', { weekAgo })
        .getCount(),
      this.userRepo.count({ where: { role: UserRole.FREE } }),
      this.subscriptionRepo.count({
        where: {
          status: In([
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
          ]),
        },
      }),
      this.subscriptionRepo
        .createQueryBuilder('s')
        .where('s.status IN (:...statuses)', {
          statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
        })
        .andWhere('s.created_at >= :monthStart', { monthStart })
        .getCount(),
      this.sumSst(),
      this.sumSst(monthStart),
      this.topSnappers(monthStart),
    ]);

    return {
      receiptsUploaded: { value: receiptsTotal, delta: receiptsToday },
      activeMembers: { value: activeMembers, delta: activeThisWeek },
      freeUsers: { value: freeUsers, delta: 0 },
      proSubscribers: { value: proSubscribers, delta: proThisMonth },
      taxSavings: { value: taxSavings, delta: taxSavingsThisMonth },
      topSnappers,
      generatedAt: now.toISOString(),
    };
  }

  // SST captured on tax-eligible confirmed receipts — our public "tax savings"
  // proxy. Optional `since` scopes it to compute the period delta.
  private async sumSst(since?: Date): Promise<number> {
    const qb = this.receiptRepo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.sst_amount), 0)', 'sum')
      .where('r.status = :status', { status: ReceiptStatus.CONFIRMED })
      .andWhere('r.tax_eligible = true');
    if (since) qb.andWhere('r.receipt_date >= :since', { since });
    const row = await qb.getRawOne<{ sum: string }>();
    return Math.round(Number(row?.sum ?? 0));
  }

  private async topSnappers(monthStart: Date) {
    const rows = await this.receiptRepo
      .createQueryBuilder('r')
      .select('r.user_id', 'userId')
      .addSelect('COUNT(*)', 'count')
      .where('r.status = :status', { status: ReceiptStatus.CONFIRMED })
      // Rank by when receipts were *snapped* (uploaded) this month, not the date
      // printed on the receipt — "top snappers this month" = activity this month.
      .andWhere('r.created_at >= :monthStart', { monthStart })
      .groupBy('r.user_id')
      .orderBy('count', 'DESC')
      .limit(8)
      .getRawMany<{ userId: string; count: string }>();

    const users = rows.length
      ? await this.userRepo.find({
          where: { id: In(rows.map((r) => r.userId)) },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return rows.map((row, i) => {
      const name = byId.get(row.userId)?.name ?? 'Anonymous';
      return {
        rank: i + 1,
        name: publicHandle(name),
        initials: initials(name),
        avatarColor: avatarColor(row.userId),
        receiptCount: Number(row.count),
      };
    });
  }
}
