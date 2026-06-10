import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Receipt, ReceiptStatus } from '../receipts/entities/receipt.entity';
import { User } from '../users/entities/user.entity';
import {
  LeaderboardPeriod,
  LeaderboardQueryDto,
} from './dto/leaderboard-query.dto';

// Podium / avatar palette mirrors the "SpillSnap Directions" leaderboard design.
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

interface RawRow {
  userId: string;
  count: string;
  weeklyGain: string;
}

export interface RankEntry {
  rank: number;
  userId: string;
  name: string;
  initials: string;
  avatarColor: string;
  avatarUrl: string | null;
  receiptCount: number;
  weeklyGain: number; // receipts added in the last 7 days
  isCurrentUser: boolean;
}

@Injectable()
export class LeaderboardService {
  constructor(
    @InjectRepository(Receipt)
    private readonly receiptRepo: Repository<Receipt>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  private periodStart(period: LeaderboardPeriod): Date | null {
    const now = new Date();
    switch (period) {
      case LeaderboardPeriod.WEEK: {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return d;
      }
      case LeaderboardPeriod.MONTH:
        return new Date(now.getFullYear(), now.getMonth(), 1);
      case LeaderboardPeriod.ALL:
      default:
        return null;
    }
  }

  async getLeaderboard(currentUser: User, query: LeaderboardQueryDto) {
    const { period, scope, limit } = query;
    const start = this.periodStart(period);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Rank by confirmed receipt-upload count within the period window.
    // `weeklyGain` is the recent-activity delta surfaced as "↑ +N" in the design.
    const qb = this.receiptRepo
      .createQueryBuilder('r')
      .select('r.user_id', 'userId')
      .addSelect('COUNT(*)', 'count')
      .addSelect(
        'COUNT(*) FILTER (WHERE r.created_at >= :weekAgo)',
        'weeklyGain',
      )
      .where('r.status = :status', { status: ReceiptStatus.CONFIRMED })
      .setParameter('weekAgo', weekAgo)
      .groupBy('r.user_id')
      .orderBy('count', 'DESC')
      .addOrderBy('"weeklyGain"', 'DESC');

    // Rank window is by snap activity (created_at) so it lines up with the
    // dashboard's "this month" (a receipt logged this month always counts).
    if (start) {
      qb.andWhere('r.created_at >= :start', { start });
    }

    // NOTE: scope is accepted now so the API contract is stable, but "friends"
    // needs a friend graph and "malaysia" needs a country column - neither
    // exists yet, so both currently resolve to the global ranking.

    const rows = await qb.getRawMany<RawRow>();

    const userIds = rows.map((r) => r.userId);
    const users = userIds.length
      ? await this.userRepo.find({ where: { id: In(userIds) } })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    // Drop rows whose user no longer exists (deleted account → orphan receipts).
    // Otherwise they'd surface as "Unknown" entries on the leaderboard.
    const liveRows = rows.filter((row) => userById.has(row.userId));

    const ranked: RankEntry[] = liveRows.map((row, i) => {
      const u = userById.get(row.userId)!;
      const name = u.name;
      return {
        rank: i + 1,
        userId: row.userId,
        name,
        initials: initials(name),
        avatarColor: avatarColor(row.userId),
        avatarUrl: u.avatarUrl ?? null,
        receiptCount: Number(row.count),
        weeklyGain: Number(row.weeklyGain),
        isCurrentUser: row.userId === currentUser.id,
      };
    });

    const podium = ranked.slice(0, 3);
    const rankings = ranked.slice(0, limit);

    // Always tell the caller where they stand, even if outside the returned page.
    const me = ranked.find((e) => e.isCurrentUser) ?? null;
    const ahead = me && me.rank > 1 ? ranked[me.rank - 2] : null; // person one place above
    const currentUserBlock = me
      ? {
          rank: me.rank,
          receiptCount: me.receiptCount,
          weeklyGain: me.weeklyGain,
          toOvertake: ahead
            ? {
                name: ahead.name,
                receiptsBehind: ahead.receiptCount - me.receiptCount,
              }
            : null,
        }
      : {
          rank: null,
          receiptCount: 0,
          weeklyGain: 0,
          toOvertake: ranked.length
            ? {
                name: ranked[ranked.length - 1].name,
                receiptsBehind: 1,
              }
            : null,
        };

    return {
      period,
      scope,
      participants: ranked.length,
      podium,
      rankings,
      currentUser: currentUserBlock,
    };
  }
}
