import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ReceiptSource } from '../../receipts/entities/receipt.entity';

/**
 * One row per Anthropic extraction call. Powers the admin dashboard's token
 * consumption, AI cost, and model-escalation metrics. `userId` is nullable so
 * system/backfill calls (no user) are still recorded; cost is computed at write
 * time from the model's published per-MTok rates (see AiUsageService).
 */
@Entity('ai_usage')
export class AiUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  @Index()
  userId: string | null;

  @Column({ type: 'enum', enum: ReceiptSource, default: ReceiptSource.APP })
  channel: ReceiptSource;

  @Column({ type: 'varchar' })
  model: string;

  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens: number;

  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens: number;

  @Column({ name: 'cache_read_tokens', type: 'int', default: 0 })
  cacheReadTokens: number;

  @Column({ name: 'cache_creation_tokens', type: 'int', default: 0 })
  cacheCreationTokens: number;

  @Column({ name: 'cost_usd', type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd: number;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
