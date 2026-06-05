import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, Repository } from 'typeorm';
import { Receipt } from '../entities/receipt.entity';
import { StorageService } from './storage.service';

// Images uploaded at capture but never saved are orphaned. Keep a grace window
// so a slow "capture → edit → save" flow is never cut off mid-way.
const GRACE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReceiptCleanupService {
  private readonly logger = new Logger(ReceiptCleanupService.name);

  constructor(
    @InjectRepository(Receipt)
    private readonly repo: Repository<Receipt>,
    private readonly storage: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'receipt-orphan-cleanup' })
  async sweepOrphans(): Promise<void> {
    const objects = await this.storage.listAllObjects();
    if (objects.length === 0) return;

    const rows = await this.repo.find({
      where: { imageUrl: Not(IsNull()) },
      select: { imageUrl: true },
    });
    const referenced = new Set(rows.map((r) => r.imageUrl));

    const cutoff = Date.now() - GRACE_MS;
    const orphans = objects
      .filter((o) => !referenced.has(o.path) && o.createdAt < cutoff)
      .map((o) => o.path);

    if (orphans.length === 0) return;
    await this.storage.removeMany(orphans);
    this.logger.log(`Removed ${orphans.length} orphaned receipt image(s)`);
  }
}
