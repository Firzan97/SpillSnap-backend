import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PushService } from '../push/push.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { Notification, NotificationType } from './entities/notification.entity';
import { prefEnabled, pushChannelOn } from './notification-prefs.util';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  emoji?: string;
  data?: Record<string, unknown>;
  /**
   * Notification toggle key (e.g. 'snap', 'streak', 'weekly'). When set, the
   * push is only sent if the user has that toggle + the push channel on. The
   * in-app feed row is always written regardless.
   */
  prefKey?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    private readonly users: UsersService,
    private readonly push: PushService,
  ) {}

  /**
   * Create a notification for a user and flag them as having unread items, then
   * deliver a push if the user's prefs allow it. Best-effort: never throw into
   * the caller's flow (it's a side effect).
   */
  async notify(userId: string, input: NotifyInput): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          userId,
          type: input.type,
          title: input.title,
          body: input.body,
          emoji: input.emoji ?? null,
          data: input.data ?? null,
        }),
      );
      await this.users.update(userId, { hasUnreadNotifications: true });
      await this.maybePush(userId, input);
    } catch (err) {
      this.logger.warn(`notify failed for ${userId}: ${(err as Error).message}`);
    }
  }

  /** Send the push leg of a notification, gated by the user's prefs. */
  private async maybePush(userId: string, input: NotifyInput): Promise<void> {
    try {
      const user = await this.users.findById(userId);
      if (!user || !pushChannelOn(user)) return;
      if (input.prefKey && !prefEnabled(user, input.prefKey)) return;
      await this.push.sendToUser(userId, {
        title: input.emoji ? `${input.emoji} ${input.title}` : input.title,
        body: input.body,
        data: { type: input.type, ...(input.data ?? {}) },
      });
    } catch (err) {
      this.logger.warn(`push failed for ${userId}: ${(err as Error).message}`);
    }
  }

  async list(user: User, page = 1, limit = 30) {
    const [rows, total] = await this.repo.findAndCount({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const unread = await this.unreadCount(user.id);
    return {
      data: rows.map((n) => this.toResponse(n)),
      total,
      unread,
      page,
      limit,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.repo.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(user: User, id: string): Promise<void> {
    await this.repo.update({ id, userId: user.id }, { readAt: new Date() });
    await this.syncFlag(user.id);
  }

  async markAllRead(user: User): Promise<void> {
    await this.repo.update(
      { userId: user.id, readAt: IsNull() },
      { readAt: new Date() },
    );
    await this.users.update(user.id, { hasUnreadNotifications: false });
  }

  private async syncFlag(userId: string): Promise<void> {
    const count = await this.unreadCount(userId);
    await this.users.update(userId, { hasUnreadNotifications: count > 0 });
  }

  private toResponse(n: Notification) {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      emoji: n.emoji,
      data: n.data,
      read: n.readAt != null,
      createdAt: n.createdAt,
    };
  }
}
