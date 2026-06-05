import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { Repository } from 'typeorm';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { PushToken } from './entities/push-token.entity';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo = new Expo();

  constructor(
    @InjectRepository(PushToken)
    private readonly repo: Repository<PushToken>,
  ) {}

  /** Upsert a device token for a user (idempotent on the token). */
  async register(userId: string, dto: RegisterPushTokenDto): Promise<void> {
    if (!Expo.isExpoPushToken(dto.token)) {
      this.logger.warn(`Ignoring non-Expo push token for ${userId}`);
      return;
    }
    const existing = await this.repo.findOne({ where: { token: dto.token } });
    if (existing) {
      if (existing.userId !== userId) {
        await this.repo.update({ token: dto.token }, { userId });
      }
      return;
    }
    await this.repo.save(
      this.repo.create({
        userId,
        token: dto.token,
        platform: dto.platform ?? 'ios',
      }),
    );
  }

  async remove(token: string): Promise<void> {
    await this.repo.delete({ token });
  }

  /** Send one push to every device a user has registered. Best-effort. */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await this.repo.find({ where: { userId } });
    if (tokens.length === 0) return;
    await this.sendToTokens(
      tokens.map((t) => t.token),
      payload,
    );
  }

  /** Fan a single payload out to many users (used by broadcasts). */
  async sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    if (userIds.length === 0) return;
    const tokens = await this.repo.find({
      where: userIds.map((userId) => ({ userId })),
    });
    await this.sendToTokens(
      tokens.map((t) => t.token),
      payload,
    );
  }

  private async sendToTokens(
    tokens: string[],
    payload: PushPayload,
  ): Promise<void> {
    const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
    if (valid.length === 0) return;

    const messages: ExpoPushMessage[] = valid.map((to) => ({
      to,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const receipts = await this.expo.sendPushNotificationsAsync(chunk);
        // Prune tokens Expo reports as no longer registered.
        await Promise.all(
          receipts.map((r, i) => {
            if (
              r.status === 'error' &&
              r.details?.error === 'DeviceNotRegistered'
            ) {
              return this.repo.delete({ token: chunk[i].to as string });
            }
            return Promise.resolve();
          }),
        );
      } catch (err) {
        this.logger.warn(`push chunk failed: ${(err as Error).message}`);
      }
    }
  }
}
