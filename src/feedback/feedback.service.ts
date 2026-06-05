import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublicFeedbackResponseDto } from './dto/public-feedback-response.dto';
import { Feedback } from './entities/feedback.entity';

// Same anonymized-handle palette as PublicStatsService/LeaderboardService so
// derived avatar colors match the rest of the marketing site.
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

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function deriveColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  // Testimonials change rarely and the landing page fetches once per load, so
  // cache one shared snapshot in memory exactly like PublicStatsService.
  private cache: PublicFeedbackResponseDto | null = null;
  private cacheExpiresAt = 0;
  private readonly ttlMs: number;
  private inFlight: Promise<PublicFeedbackResponseDto> | null = null;

  constructor(
    @InjectRepository(Feedback)
    private readonly feedbackRepo: Repository<Feedback>,
    config: ConfigService,
  ) {
    this.ttlMs = config.get<number>('PUBLIC_STATS_TTL_MS') ?? 60 * 60 * 1000; // 1h
  }

  async getPublicFeedback(): Promise<PublicFeedbackResponseDto> {
    if (this.cache && Date.now() < this.cacheExpiresAt) return this.cache;
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.compute()
      .then((res) => {
        this.cache = res;
        this.cacheExpiresAt = Date.now() + this.ttlMs;
        return res;
      })
      .catch((err) => {
        // Serve the stale snapshot on failure — a slightly old testimonials list
        // beats a 500 on the landing page. (Web renders a real empty state when
        // items is empty, so an empty table is safe too.)
        this.logger.error('Failed to compute public feedback', err as Error);
        if (this.cache) return this.cache;
        throw err;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  private async compute(): Promise<PublicFeedbackResponseDto> {
    const rows = await this.feedbackRepo.find({
      where: { approved: true },
      order: { displayOrder: 'ASC', createdAt: 'DESC' },
      take: 24,
    });

    const items = rows.map((f) => ({
      quote: f.quote,
      name: f.name,
      role: f.role,
      avatarColor: f.avatarColor || deriveColor(f.id),
      initials: f.initials || deriveInitials(f.name),
      rating: f.rating,
    }));

    // Aggregate the rating over EVERY approved row (not just the 24 returned)
    // so the headline "4.8" reflects all reviews. One grouped query, no N+1.
    const agg = await this.feedbackRepo
      .createQueryBuilder('f')
      .select('AVG(f.rating)', 'avg')
      .addSelect('COUNT(*)', 'count')
      .where('f.approved = :approved', { approved: true })
      .getRawOne<{ avg: string | null; count: string }>();

    const reviewCount = Number(agg?.count ?? 0);
    const averageRating = reviewCount
      ? Math.round(Number(agg?.avg ?? 0) * 10) / 10
      : 0;

    return {
      items,
      averageRating,
      reviewCount,
      generatedAt: new Date().toISOString(),
    };
  }
}
