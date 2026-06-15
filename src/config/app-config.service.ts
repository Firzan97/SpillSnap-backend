import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from './entities/app-config.entity';

/**
 * Read/write editable runtime settings. `get` returns the stored override or the
 * provided code default, so an unset key behaves exactly like the hardcoded
 * config. Reads are cached in-process and invalidated on write.
 */
@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);
  private readonly cache = new Map<string, unknown>();

  constructor(
    @InjectRepository(AppConfig)
    private readonly repo: Repository<AppConfig>,
  ) {}

  /** Stored value for `key`, or `fallback` when unset. */
  async get<T>(key: string, fallback: T): Promise<T> {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    try {
      const row = await this.repo.findOne({ where: { key } });
      const value = (row?.value ?? fallback) as T;
      this.cache.set(key, value);
      return value;
    } catch (err) {
      this.logger.error(`Failed reading config "${key}": ${(err as Error).message}`);
      return fallback;
    }
  }

  /** Whether an override row exists (vs. running on the code default). */
  async isOverridden(key: string): Promise<boolean> {
    return (await this.repo.count({ where: { key } })) > 0;
  }

  /** Upsert the override for `key` (PK is `key`, so save updates in place). */
  async set<T>(key: string, value: T): Promise<T> {
    // Cast the literal to the entity: the `value` column is `unknown` (jsonb),
    // which TypeORM's DeepPartial can't infer from the generic T otherwise.
    await this.repo.save({ key, value } as AppConfig);
    this.cache.set(key, value);
    return value;
  }

  /** Drop the override → service falls back to the code default again. */
  async reset(key: string): Promise<void> {
    await this.repo.delete({ key });
    this.cache.delete(key);
  }
}
