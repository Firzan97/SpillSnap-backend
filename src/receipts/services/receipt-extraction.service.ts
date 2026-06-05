import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  LineItem,
  LhdnRelief,
  ReceiptCategory,
} from '../entities/receipt.entity';

// Cheap, accurate default; escalate to Opus when the model is unsure.
const FAST_MODEL = 'claude-haiku-4-5-20251001';
const ACCURATE_MODEL = 'claude-opus-4-8';
const CONFIDENCE_THRESHOLD = 70;

export interface ExtractedReceipt {
  isReceipt: boolean; // false when the image isn't a receipt at all
  rejectReason: string | null; // user-facing hint when isReceipt is false
  merchant: string;
  receiptDate: string | null; // ISO 8601
  currency: string;
  subtotal: number | null;
  sstAmount: number | null;
  total: number;
  paymentMethod: string | null;
  location: string | null;
  items: LineItem[];
  suggestedCategory: ReceiptCategory;
  suggestedRelief: LhdnRelief;
  taxEligible: boolean;
  confidence: number; // 0-100
}

const SYSTEM_PROMPT = `You are a receipt-extraction engine for SpendSnap, a Malaysian expense + tax app.
Extract structured data from the receipt image and call the \`save_receipt\` tool exactly once.

Rules:
- isReceipt: FIRST decide whether the image actually IS a purchase receipt or invoice
  (merchant + line items/total). Set isReceipt=false for anything else — selfies, random
  photos, screenshots of apps/chats, blank pages, ID cards, menus, handwritten notes.
  When isReceipt=false, set rejectReason to a short friendly reason (e.g. "This looks like a
  selfie, not a receipt") and leave the other fields at their defaults / 0.
- Amounts are numbers only (no symbols). currency = the receipt's own ISO 4217 code, detected
  from its symbol/text (e.g. RM/MYR, $/USD, Rp/IDR, ฿/THB, S$/SGD, €/EUR, £/GBP, ¥/JPY).
  Default to "MYR" only when no currency is shown. Do NOT convert amounts — report them exactly
  as printed in the receipt's own currency.
- receiptDate: ISO 8601 with time if present (e.g. 2026-05-16T17:30:00). Null if absent.
- items: one entry per purchased line. qty defaults to 1. unitPrice and total are the per-line figures.
- subtotal = pre-tax, sstAmount = SST/service tax, total = grand total actually paid.
- suggestedCategory: best fit from the allowed list.
- suggestedRelief + taxEligible: Malaysian LHDN personal relief. sports gear -> sports; books -> books;
  gym/internet/phone/electronics -> lifestyle; clinic/pharmacy/medical -> medical; EV charging -> ev_charging;
  breastfeeding equipment -> breastfeeding; childcare centre/kindergarten/nursery fees -> childcare;
  self education/tuition/course fees (recognised study) -> education. Anything else -> none / taxEligible false.
- confidence: 0-100, how sure you are about the total + merchant. Be honest; low for blurry/partial receipts.`;

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'save_receipt',
  description: 'Record the structured data extracted from the receipt.',
  input_schema: {
    type: 'object',
    properties: {
      isReceipt: {
        type: 'boolean',
        description:
          'True only if the image is a real purchase receipt or invoice',
      },
      rejectReason: {
        type: 'string',
        description:
          'Short friendly reason when isReceipt is false; empty otherwise',
      },
      merchant: { type: 'string' },
      receiptDate: {
        type: 'string',
        description: 'ISO 8601 datetime, or empty string if not found',
      },
      currency: { type: 'string', default: 'MYR' },
      subtotal: { type: 'number' },
      sstAmount: { type: 'number' },
      total: { type: 'number' },
      paymentMethod: { type: 'string' },
      location: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            qty: { type: 'number' },
            unitPrice: { type: 'number' },
            total: { type: 'number' },
          },
          required: ['name', 'qty', 'unitPrice', 'total'],
        },
      },
      suggestedCategory: {
        type: 'string',
        enum: Object.values(ReceiptCategory),
      },
      suggestedRelief: { type: 'string', enum: Object.values(LhdnRelief) },
      taxEligible: { type: 'boolean' },
      confidence: { type: 'number', minimum: 0, maximum: 100 },
    },
    required: [
      'isReceipt',
      'merchant',
      'total',
      'items',
      'suggestedCategory',
      'confidence',
    ],
  },
};

@Injectable()
export class ReceiptExtractionService {
  private readonly logger = new Logger(ReceiptExtractionService.name);
  private readonly client: Anthropic;

  constructor(config: ConfigService) {
    // getOrThrow only guards `undefined` — an empty value (e.g. `ANTHROPIC_API_KEY=`
    // in .env) slips through and only surfaces later as an opaque 500 on capture.
    // Fail loudly at boot instead.
    const apiKey = config.get<string>('ANTHROPIC_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is missing or empty — set a real key in the backend .env before starting.',
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Extract one receipt from one or more images. Multiple images are treated as
   * sequential top-to-bottom sections of a single (long) receipt and merged into
   * one result by the model — no client-side stitching needed.
   */
  async extract(
    files: { buffer: Buffer; mimetype: string }[],
  ): Promise<ExtractedReceipt> {
    const fast = await this.run(FAST_MODEL, files);
    // Not a receipt — escalating for accuracy is pointless, reject straight away.
    if (!fast.isReceipt) return fast;
    if (fast.confidence >= CONFIDENCE_THRESHOLD) return fast;

    // Low confidence — retry once on the stronger model.
    this.logger.log(
      `Confidence ${fast.confidence} < ${CONFIDENCE_THRESHOLD}; escalating to ${ACCURATE_MODEL}`,
    );
    try {
      return await this.run(ACCURATE_MODEL, files);
    } catch (err) {
      this.logger.warn(
        `Escalation failed, using fast result: ${(err as Error).message}`,
      );
      return fast;
    }
  }

  private async run(
    model: string,
    files: { buffer: Buffer; mimetype: string }[],
  ): Promise<ExtractedReceipt> {
    const imageBlocks = files.map((file) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: this.normalizeMime(file.mimetype),
        data: file.buffer.toString('base64'),
      },
    }));

    const instruction =
      files.length > 1
        ? `These ${files.length} images are sequential top-to-bottom sections of ONE single receipt (a long receipt photographed in parts). Combine them and extract the receipt exactly once — merge all line items in order and use the grand total from the final section.`
        : 'Extract this receipt.';

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model,
        max_tokens: 2048,
        // Cache the system prompt + tool schema — identical on every call.
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: [{ ...EXTRACTION_TOOL, cache_control: { type: 'ephemeral' } }],
        tool_choice: { type: 'tool', name: 'save_receipt' },
        messages: [
          {
            role: 'user',
            content: [...imageBlocks, { type: 'text', text: instruction }],
          },
        ],
      });
    } catch (err) {
      // Anthropic SDK / network failure (bad key, rate limit, overloaded, timeout).
      // Surface a clear 503 instead of an opaque 500 so the client can say something useful.
      const status = (err as { status?: number })?.status;
      this.logger.error(
        `Anthropic request failed (model=${model}, status=${status ?? 'n/a'}): ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Receipt scanning is temporarily unavailable. Please try again in a moment.',
      );
    }

    const toolUse = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (!toolUse) {
      this.logger.error('Model returned no tool_use block');
      throw new InternalServerErrorException('Could not read the receipt');
    }

    return this.normalize(toolUse.input as Record<string, unknown>);
  }

  private normalize(raw: Record<string, unknown>): ExtractedReceipt {
    const num = (v: unknown): number | null =>
      typeof v === 'number' && !Number.isNaN(v) ? v : null;
    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

    const items = Array.isArray(raw.items)
      ? (raw.items as LineItem[]).map((i) => ({
          name: String(i.name ?? ''),
          qty: Number(i.qty ?? 1),
          unitPrice: Number(i.unitPrice ?? 0),
          total: Number(i.total ?? 0),
        }))
      : [];

    return {
      // Default true only when the key is missing entirely; an explicit false rejects.
      isReceipt: raw.isReceipt !== false,
      rejectReason: str(raw.rejectReason),
      merchant: str(raw.merchant) ?? 'Unknown merchant',
      receiptDate: str(raw.receiptDate),
      currency: str(raw.currency) ?? 'MYR',
      subtotal: num(raw.subtotal),
      sstAmount: num(raw.sstAmount),
      total: num(raw.total) ?? 0,
      paymentMethod: str(raw.paymentMethod),
      location: str(raw.location),
      items,
      suggestedCategory:
        (str(raw.suggestedCategory) as ReceiptCategory) ??
        ReceiptCategory.OTHER,
      suggestedRelief:
        (str(raw.suggestedRelief) as LhdnRelief) ?? LhdnRelief.NONE,
      taxEligible: raw.taxEligible === true,
      confidence: num(raw.confidence) ?? 0,
    };
  }

  private normalizeMime(
    mime: string,
  ): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' {
    if (mime === 'image/png') return 'image/png';
    if (mime === 'image/webp') return 'image/webp';
    if (mime === 'image/gif') return 'image/gif';
    return 'image/jpeg';
  }
}
