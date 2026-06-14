import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReceiptSource } from '../receipts/entities/receipt.entity';
import { AiUsage } from './entities/ai-usage.entity';

/**
 * Anthropic published per-MTok USD rates (input / output). Keyed by the model
 * id strings used in ReceiptExtractionService. Cache reads bill at ~0.1x input
 * and 5-minute cache writes at ~1.25x input. Update when the model set or
 * pricing changes. Unknown models fall back to ZERO (logged) so a typo never
 * silently invents a cost.
 */
interface ModelRate {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens
}

const MODEL_RATES: Record<string, ModelRate> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export interface AiUsageInput {
  userId: string | null;
  channel: ReceiptSource;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    @InjectRepository(AiUsage)
    private readonly repo: Repository<AiUsage>,
  ) {}

  /** USD cost of one call from token counts + the model's published rates. */
  computeCost(input: AiUsageInput): number {
    const rate = MODEL_RATES[input.model];
    if (!rate) {
      this.logger.warn(`No price for model "${input.model}"; cost recorded as 0`);
      return 0;
    }
    const cacheRead = input.cacheReadTokens ?? 0;
    const cacheWrite = input.cacheCreationTokens ?? 0;
    const inputUsd =
      (input.inputTokens * rate.input +
        cacheRead * rate.input * CACHE_READ_MULTIPLIER +
        cacheWrite * rate.input * CACHE_WRITE_MULTIPLIER) /
      1_000_000;
    const outputUsd = (input.outputTokens * rate.output) / 1_000_000;
    return Number((inputUsd + outputUsd).toFixed(6));
  }

  /**
   * Persist one usage row. Never throws into the caller's request path — a
   * failed insert is logged and swallowed so receipt extraction still succeeds.
   */
  async record(input: AiUsageInput): Promise<void> {
    try {
      const row = this.repo.create({
        userId: input.userId,
        channel: input.channel,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cacheReadTokens: input.cacheReadTokens ?? 0,
        cacheCreationTokens: input.cacheCreationTokens ?? 0,
        costUsd: this.computeCost(input),
      });
      await this.repo.save(row);
    } catch (err) {
      this.logger.error(`Failed to record AI usage: ${(err as Error).message}`);
    }
  }
}
