import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createClient } from '@supabase/supabase-js';
import { In, Repository } from 'typeorm';
import { Receipt } from '../receipts/entities/receipt.entity';
import { StorageService } from '../receipts/services/storage.service';
import { UserTag } from './entities/user-tag.entity';
import {
  NotificationPrefs,
  SecurityPrefs,
  User,
} from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';
import {
  buildAccountScreen,
  buildHelpScreen,
  buildSettingsIndex,
  Platform,
} from './settings.config';
import {
  CATEGORY_COLORS,
  defaultNotificationPrefs,
  defaultSecurityPrefs,
  NOTIFICATION_GROUPS,
} from './settings.defaults';

/** Tags that get a highlighted tone in the UI (returned as `tone`). */
const TAG_TONES: Record<string, string> = {
  '#tax-2026': 'aqua',
  '#tax': 'aqua',
  '#weekly': 'aqua',
  '#reimbursable': 'amber',
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  /** Service-role client for admin auth ops (user deletion). */
  private readonly supabaseAdmin: ReturnType<typeof createClient>;

  constructor(
    @InjectRepository(Receipt)
    private readonly receiptRepo: Repository<Receipt>,
    @InjectRepository(UserTag)
    private readonly userTagRepo: Repository<UserTag>,
    private readonly usersService: UsersService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly receiptsService: ReceiptsService,
  ) {
    this.supabaseAdmin = createClient(
      this.config.getOrThrow('SUPABASE_URL'),
      this.config.getOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false } },
    );
  }

  /** Normalize a tag to a single leading '#', spaces → hyphens. */
  private normalizeTag(raw: string): string {
    const body = raw.trim().replace(/^#+/, '').replace(/\s+/g, '-');
    if (!body) throw new BadRequestException('Tag name is required');
    return `#${body}`;
  }

  // ── Settings index (Profile menu) ──────────────────────────────────────────────
  index(platform?: Platform) {
    const screen = buildSettingsIndex(platform);
    return {
      ...screen,
      meta: { appVersion: this.config.get<string>('APP_VERSION') ?? '1.0.0' },
    };
  }

  // ── Help & support ─────────────────────────────────────────────────────────────
  help() {
    return buildHelpScreen(this.config.get<string>('APP_VERSION') ?? '1.0.0');
  }

  // ── Account & security ───────────────────────────────────────────────────────
  account(user: User, platform?: Platform) {
    const security = user.securityPrefs ?? defaultSecurityPrefs();
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      baseCurrency: user.baseCurrency ?? 'MYR',
      authProvider: user.authProvider,
      memberSince: user.createdAt,
      emailVerified: true, // Supabase confirms email before a session exists
      phoneVerified: !!user.phone,
      security,
      // Server-driven screen config; Face ID row is iOS-only (gated by platform).
      ...buildAccountScreen(user, security.faceIdUnlock, platform),
    };
  }

  async updateAccount(user: User, dto: UpdateAccountDto) {
    const patch: Partial<User> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.faceIdUnlock !== undefined) {
      const security: SecurityPrefs = {
        ...(user.securityPrefs ?? defaultSecurityPrefs()),
      };
      security.faceIdUnlock = dto.faceIdUnlock;
      patch.securityPrefs = security;
    }

    const baseChanged =
      dto.baseCurrency !== undefined && dto.baseCurrency !== user.baseCurrency;
    if (baseChanged) patch.baseCurrency = dto.baseCurrency;

    const updated = await this.usersService.update(user.id, patch);

    // Changing the base currency re-converts every existing receipt so all
    // totals stay consistent in the new currency.
    if (baseChanged) await this.receiptsService.recomputeBaseAmounts(updated);

    return this.account(updated);
  }

  /** Upload a new profile photo, store its public URL, return the account. */
  async updateAvatar(user: User, file: Express.Multer.File) {
    const url = await this.storage.uploadAvatar(user.id, file);
    // Drop the previous avatar (if we owned it) so storage doesn't accumulate.
    if (user.avatarUrl && user.avatarUrl !== url) {
      await this.storage.removeAvatar(user.avatarUrl);
    }
    const updated = await this.usersService.update(user.id, { avatarUrl: url });
    return this.account(updated);
  }

  /** Clear the profile photo, removing the stored object if we own it. */
  async removeAvatar(user: User) {
    if (user.avatarUrl) await this.storage.removeAvatar(user.avatarUrl);
    const updated = await this.usersService.update(user.id, { avatarUrl: null });
    return this.account(updated);
  }

  /**
   * Permanently delete the user. Removes stored receipt images, then the local
   * profile row (receipts cascade via FK), then the Supabase Auth user so they
   * can't sign back in.
   */
  async deleteAccount(user: User): Promise<void> {
    const receipts = await this.receiptRepo.find({
      where: { userId: user.id },
      select: { id: true, imageUrl: true, imagePaths: true },
    });
    const paths = receipts.flatMap((r) =>
      r.imagePaths?.length ? r.imagePaths : r.imageUrl ? [r.imageUrl] : [],
    );
    if (paths.length) await this.storage.removeMany(paths);

    await this.usersService.delete(user.id);

    if (user.supabaseId) {
      const { error } = await this.supabaseAdmin.auth.admin.deleteUser(
        user.supabaseId,
      );
      if (error) {
        // Local row is already gone; log so the orphaned auth user can be reaped.
        this.logger.error(
          `Supabase auth delete failed for ${user.supabaseId}: ${error.message}`,
        );
      }
    }
  }

  // ── Categories (aggregated from receipts) ──────────────────────────────────────
  async categories(user: User) {
    const rows = await this.receiptRepo
      .createQueryBuilder('r')
      .select('r.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(COALESCE(r.base_amount, r.amount)), 0)', 'total')
      .where('r.user_id = :userId', { userId: user.id })
      .groupBy('r.category')
      .getRawMany<{ category: string; count: string; total: string }>();

    const byKey = new Map(rows.map((r) => [r.category, r]));

    const categories = Object.keys(CATEGORY_COLORS)
      .map((key) => {
        const row = byKey.get(key);
        return {
          key,
          label: key.charAt(0).toUpperCase() + key.slice(1),
          color: CATEGORY_COLORS[key],
          receiptCount: row ? Number(row.count) : 0,
          totalAmount: row ? Number(Number(row.total).toFixed(2)) : 0,
        };
      })
      .sort((a, b) => b.totalAmount - a.totalAmount);

    return { categories, total: categories.length };
  }

  // ── Tags (usage from receipts.tags + user-saved tags) ──────────────────────────
  async tags(user: User) {
    const [rows, saved] = await Promise.all([
      this.receiptRepo.find({
        where: { userId: user.id },
        select: { id: true, tags: true },
      }),
      this.userTagRepo.find({ where: { userId: user.id } }),
    ]);

    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const t of r.tags ?? []) {
        const tag = t.startsWith('#') ? t : `#${t}`;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    // Saved tags appear even with 0 usage so the user can reuse them.
    for (const st of saved) {
      if (!counts.has(st.name)) counts.set(st.name, 0);
    }

    const tags = Array.from(counts.entries())
      .map(([tag, count]) => ({
        tag,
        count,
        tone: TAG_TONES[tag] ?? 'neutral',
      }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    return { tags, total: tags.length };
  }

  /** Save a reusable custom tag. Idempotent (ignores duplicates). */
  async addTag(user: User, rawName: string) {
    const name = this.normalizeTag(rawName);
    const exists = await this.userTagRepo.findOne({
      where: { userId: user.id, name },
    });
    if (!exists) {
      await this.userTagRepo.save(
        this.userTagRepo.create({ userId: user.id, name }),
      );
    }
    return this.tags(user);
  }

  /** Remove a saved tag definition (does not touch tags already on receipts). */
  async removeTag(user: User, rawName: string) {
    const name = this.normalizeTag(rawName);
    await this.userTagRepo.delete({ userId: user.id, name });
    return this.tags(user);
  }

  /**
   * Merge `from` tags into a single `into` tag: rewrite every receipt that uses
   * any source tag, then drop the merged-away saved tags. The canonical tag is
   * saved so it persists even if no receipt ends up using it.
   */
  async mergeTags(user: User, rawFrom: string[], rawInto: string) {
    const into = this.normalizeTag(rawInto);
    const from = rawFrom
      .map((t) => this.normalizeTag(t))
      .filter((t) => t !== into);
    if (from.length === 0) throw new BadRequestException('Nothing to merge');
    const fromSet = new Set(from);

    const receipts = await this.receiptRepo.find({
      where: { userId: user.id },
      select: { id: true, tags: true },
    });

    const dirty: Receipt[] = [];
    for (const r of receipts) {
      const tags = r.tags ?? [];
      if (!tags.some((t) => fromSet.has(t.startsWith('#') ? t : `#${t}`)))
        continue;
      const next = new Set<string>();
      for (const t of tags) {
        const norm = t.startsWith('#') ? t : `#${t}`;
        next.add(fromSet.has(norm) ? into : norm);
      }
      r.tags = Array.from(next);
      dirty.push(r);
    }
    if (dirty.length) await this.receiptRepo.save(dirty);

    // Drop merged-away saved tags, keep the canonical one.
    await this.userTagRepo.delete({ userId: user.id, name: In(from) });
    const exists = await this.userTagRepo.findOne({
      where: { userId: user.id, name: into },
    });
    if (!exists) {
      await this.userTagRepo.save(
        this.userTagRepo.create({ userId: user.id, name: into }),
      );
    }

    return this.tags(user);
  }

  // ── Notification preferences ───────────────────────────────────────────────────
  notifications(user: User) {
    const stored = user.notificationPrefs;
    const defaults = defaultNotificationPrefs();
    const merged: NotificationPrefs = {
      channels: { ...defaults.channels, ...(stored?.channels ?? {}) },
      prefs: { ...defaults.prefs, ...(stored?.prefs ?? {}) },
      quietHours: { ...defaults.quietHours, ...(stored?.quietHours ?? {}) },
    };

    // Project the persisted booleans onto the labelled group structure for the UI.
    const groups = NOTIFICATION_GROUPS.map((g) => ({
      title: g.title,
      rows: g.rows.map((r) => ({
        key: r.key,
        label: r.label,
        sub: r.sub,
        on: merged.prefs[r.key] ?? r.default,
      })),
    }));

    return { channels: merged.channels, groups, quietHours: merged.quietHours };
  }

  async updateNotifications(user: User, dto: UpdateNotificationsDto) {
    const current: NotificationPrefs = {
      ...defaultNotificationPrefs(),
      ...(user.notificationPrefs ?? {}),
    };
    const next: NotificationPrefs = {
      channels: { ...current.channels, ...(dto.channels ?? {}) },
      prefs: { ...current.prefs, ...(dto.prefs ?? {}) },
      quietHours: { ...current.quietHours, ...(dto.quietHours ?? {}) },
    };
    const updated = await this.usersService.update(user.id, {
      notificationPrefs: next,
    });
    return this.notifications(updated);
  }
}
