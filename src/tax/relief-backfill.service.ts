import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LhdnRelief,
  Receipt,
  ReceiptStatus,
} from '../receipts/entities/receipt.entity';
import { User } from '../users/entities/user.entity';
import { CATEGORY_TO_RELIEF } from './relief-rules.config';

// Cheap text-only classifier — no image, just the structured fields we already
// extracted at capture. Confident guesses are applied; below this they're left
// untagged and surfaced for the user to confirm (so totals stay trustworthy).
const MODEL = 'claude-haiku-4-5-20251001';
const APPLY_THRESHOLD = 70;
const BATCH_SIZE = 30;

const SYSTEM_PROMPT = `You classify Malaysian purchase receipts into the LHDN personal-relief category they can be claimed under, from their merchant + items. Call \`classify_reliefs\` once with one result per receipt id.

Relief categories:
- lifestyle: books, computers, smartphones, tablets, internet subscription, gym membership, skill-improvement courses
- sports: sports equipment, gym/facility fees, competition registration
- medical: clinics, hospitals, pharmacies, dental, vaccination, serious-disease treatment
- ev_charging: EV charging facilities / equipment
- breastfeeding: breast pumps and breastfeeding equipment
- childcare: registered childcare centre, kindergarten, nursery / taska / tadika fees
- education: self tuition/course/university fees for recognised study
- none: groceries, dining, fuel, transport, utilities, general shopping, or anything not clearly claimable

Be conservative: if it isn't clearly one of the relief categories, return none. confidence 0-100 = how sure you are.`;

interface ClassifyInput {
  id: string;
  merchant: string;
  category: string;
  items: string[];
}

interface ClassifyResult {
  id: string;
  relief: LhdnRelief;
  confidence: number;
}

export interface BackfillSummary {
  scanned: number; // untagged receipts examined
  autoMapped: number; // Layer 1 — free category→relief map
  aiTagged: number; // Layer 2 — Haiku, applied (confident)
  needsReview: number; // Layer 2 — relief suggested but low confidence, left untagged
  stillNone: number; // genuinely not claimable
}

@Injectable()
export class ReliefBackfillService {
  private readonly logger = new Logger(ReliefBackfillService.name);
  private readonly client: Anthropic;

  constructor(
    @InjectRepository(Receipt)
    private readonly receipts: Repository<Receipt>,
    config: ConfigService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is missing or empty — set a real key in the backend .env before starting.',
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Tag confirmed receipts that have no relief yet (lhdnRelief = none) for this
   * user. Only touches untagged receipts, so a user-set tag is never clobbered.
   */
  async backfillForUser(user: User): Promise<BackfillSummary> {
    const untagged = await this.receipts.find({
      where: {
        userId: user.id,
        status: ReceiptStatus.CONFIRMED,
        lhdnRelief: LhdnRelief.NONE,
      },
    });

    const summary: BackfillSummary = {
      scanned: untagged.length,
      autoMapped: 0,
      aiTagged: 0,
      needsReview: 0,
      stillNone: 0,
    };
    if (untagged.length === 0) return summary;

    // ── Layer 1: free deterministic map (no AI) ──────────────────────────────
    const ambiguous: Receipt[] = [];
    const toSave: Receipt[] = [];
    for (const r of untagged) {
      const mapped = CATEGORY_TO_RELIEF[r.category];
      if (mapped) {
        r.lhdnRelief = mapped;
        r.taxEligible = true;
        r.reliefSource = 'backfill';
        r.reliefConfidence = 100;
        toSave.push(r);
        summary.autoMapped++;
      } else {
        ambiguous.push(r);
      }
    }

    // ── Layer 2: Haiku for the rest (text only, batched) ─────────────────────
    for (let i = 0; i < ambiguous.length; i += BATCH_SIZE) {
      const batch = ambiguous.slice(i, i + BATCH_SIZE);
      const results = await this.classify(batch);
      const byId = new Map(results.map((res) => [res.id, res]));

      for (const r of batch) {
        const res = byId.get(r.id);
        if (!res || res.relief === LhdnRelief.NONE) {
          summary.stillNone++;
          continue;
        }
        if (res.confidence < APPLY_THRESHOLD) {
          // Suggested but unsure — leave untagged so it doesn't inflate totals.
          summary.needsReview++;
          continue;
        }
        r.lhdnRelief = res.relief;
        r.taxEligible = true;
        r.reliefSource = 'backfill';
        r.reliefConfidence = Math.round(res.confidence);
        toSave.push(r);
        summary.aiTagged++;
      }
    }

    if (toSave.length) await this.receipts.save(toSave);
    return summary;
  }

  private async classify(batch: Receipt[]): Promise<ClassifyResult[]> {
    const input: ClassifyInput[] = batch.map((r) => ({
      id: r.id,
      merchant: r.merchant,
      category: r.category,
      items: (r.lineItems ?? []).map((li) => li.name).slice(0, 20),
    }));

    const tool: Anthropic.Tool = {
      name: 'classify_reliefs',
      description: 'Return the LHDN relief category for each receipt id.',
      input_schema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                relief: { type: 'string', enum: Object.values(LhdnRelief) },
                confidence: { type: 'number', minimum: 0, maximum: 100 },
              },
              required: ['id', 'relief', 'confidence'],
            },
          },
        },
        required: ['results'],
      },
    };

    try {
      const message = await this.client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        tools: [{ ...tool, cache_control: { type: 'ephemeral' } }],
        tool_choice: { type: 'tool', name: 'classify_reliefs' },
        messages: [
          { role: 'user', content: JSON.stringify(input) },
        ],
      });

      const toolUse = message.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      const results = (toolUse?.input as { results?: ClassifyResult[] })?.results;
      return Array.isArray(results) ? results : [];
    } catch (err) {
      // Don't fail the whole back-fill on one bad batch — skip it (those stay
      // untagged and can be retried) and log for visibility.
      this.logger.warn(
        `Relief classify batch failed (${batch.length} receipts): ${(err as Error).message}`,
      );
      return [];
    }
  }
}
