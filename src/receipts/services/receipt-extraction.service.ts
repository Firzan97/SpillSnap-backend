import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import {
  LineItem,
  LhdnRelief,
  ReceiptCategory,
  ReceiptSource,
} from '../entities/receipt.entity';
import { AiUsageService } from '../../billing/ai-usage.service';

/** Who/where an extraction ran, for AI-usage attribution. */
export interface ExtractionContext {
  userId: string | null;
  channel: ReceiptSource;
}

// Cheap, accurate default; escalate to Sonnet (not Opus - too pricey) when unsure.
const FAST_MODEL = 'claude-haiku-4-5-20251001';
const ACCURATE_MODEL = 'claude-sonnet-4-6';
const CONFIDENCE_THRESHOLD = 70;

// Receipt images are downscaled before being sent to the model. Vision token
// cost scales with resolution, so capping the long edge + re-encoding as JPEG
// cuts input tokens (and $) materially with no accuracy loss for receipts.
// The full-resolution original is still what gets stored (this only shrinks
// the model payload). 1280px keeps small text legible; q72 is a good balance.
const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 72;

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
  complete: boolean; // false when the receipt looks cut off / only partially captured
  multipleReceipts: boolean; // true when the image(s) hold 2+ distinct receipts
}

const SYSTEM_PROMPT = `You are a receipt-extraction engine for SpillSnap, a Malaysian expense + tax app.
Extract structured data from the receipt image and call the \`save_receipt\` tool exactly once.

Rules:
- isReceipt: FIRST decide whether the image actually IS a purchase receipt or invoice
  (merchant + line items/total). Set isReceipt=false for anything else - selfies, random
  photos, screenshots of apps/chats, blank pages, ID cards, menus, handwritten notes.
  When isReceipt=false, set rejectReason to a short friendly reason (e.g. "This looks like a
  selfie, not a receipt") and leave the other fields at their defaults / 0.
- Amounts are numbers only (no symbols). currency = the receipt's own ISO 4217 code, detected
  from its symbol/text (e.g. RM/MYR, $/USD, Rp/IDR, ฿/THB, S$/SGD, €/EUR, £/GBP, ¥/JPY).
  Default to "MYR" only when no currency is shown. Do NOT convert amounts - report them exactly
  as printed in the receipt's own currency.
- receiptDate: ISO 8601 with time if present (e.g. 2026-05-16T17:30:00). Null if absent.
- items: one entry per purchased line. qty defaults to 1. unitPrice and total are the per-line figures.
- subtotal = pre-tax, sstAmount = SST/service tax, total = grand total actually paid.
- suggestedCategory: best fit from the allowed list.
- suggestedRelief + taxEligible: Malaysian LHDN personal relief. sports gear -> sports; books -> books;
  gym/internet/phone/electronics -> lifestyle; clinic/pharmacy/medical -> medical; EV charging -> ev_charging;
  breastfeeding equipment -> breastfeeding; childcare centre/kindergarten/nursery fees -> childcare;
  self education/tuition/course fees (recognised study) -> education. Anything else -> none / taxEligible false.
- confidence: 0-100, how sure you are about the total + merchant. Be honest; low for blurry/partial receipts.
- complete: TRUE if the image (or, for multiple images, the set together) shows the WHOLE receipt end-to-end,
  including the grand total / payment line / footer. Set FALSE when it looks cut off or partial - line items
  end abruptly with no grand total visible, or the top/bottom is clearly missing (a long receipt photographed
  only halfway). When in doubt and no grand total is visible, set complete=false.
- multipleReceipts: TRUE only if the image(s) clearly contain TWO OR MORE DIFFERENT receipts (different
  merchants or separate transactions). IMPORTANT: when several images are sent they are normally sequential
  sections of ONE long receipt - keep multipleReceipts=false for those. Set it true only for genuinely
  distinct, separate receipts (e.g. two unrelated receipts in one photo, or each photo a different shop). When
  multipleReceipts=true, still extract the FIRST/primary receipt into the other fields.`;

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
      complete: {
        type: 'boolean',
        description:
          'True if the whole receipt (incl. grand total/footer) is captured; false if cut off/partial',
      },
      multipleReceipts: {
        type: 'boolean',
        description:
          'True if the image(s) contain 2+ distinct receipts (not sections of one long receipt)',
      },
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
  // Tunable without a redeploy. Smaller edge = fewer vision tokens = faster/cheaper.
  private readonly maxEdgePx: number;
  private readonly confidenceThreshold: number;

  constructor(
    config: ConfigService,
    private readonly aiUsage: AiUsageService,
  ) {
    // getOrThrow only guards `undefined` - an empty value (e.g. `ANTHROPIC_API_KEY=`
    // in .env) slips through and only surfaces later as an opaque 500 on capture.
    // Fail loudly at boot instead.
    const apiKey = config.get<string>('ANTHROPIC_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is missing or empty - set a real key in the backend .env before starting.',
      );
    }
    this.client = new Anthropic({ apiKey });
    this.maxEdgePx =
      config.get<number>('RECEIPT_MAX_EDGE_PX') ?? MAX_EDGE_PX;
    this.confidenceThreshold =
      config.get<number>('RECEIPT_CONFIDENCE_THRESHOLD') ?? CONFIDENCE_THRESHOLD;
  }

  /**
   * Extract one receipt from one or more images. Multiple images are treated as
   * sequential top-to-bottom sections of a single (long) receipt and merged into
   * one result by the model - no client-side stitching needed.
   */
  async extract(
    files: { buffer: Buffer; mimetype: string }[],
    ctx: ExtractionContext = { userId: null, channel: ReceiptSource.APP },
  ): Promise<ExtractedReceipt> {
    // Timing breakdown so we can see where a slow scan spends its time:
    // payload size, the fast pass, and (if it happens) the accurate escalation.
    const totalBytes = files.reduce((s, f) => s + f.buffer.byteLength, 0);
    const t0 = Date.now();

    // Downscale once and reuse for both the fast pass and any escalation, so we
    // never pay full-resolution vision tokens twice.
    const shrunk = await this.downscaleAll(files);
    const shrunkBytes = shrunk.reduce((s, f) => s + f.buffer.byteLength, 0);
    this.logger.log(
      `[scan] downscale ${(totalBytes / 1024).toFixed(0)}KB → ${(shrunkBytes / 1024).toFixed(0)}KB`,
    );

    const fast = await this.run(FAST_MODEL, shrunk, ctx);
    const tFast = Date.now() - t0;

    // Not a receipt - escalating for accuracy is pointless, reject straight away.
    if (!fast.isReceipt) {
      this.logger.log(
        `[scan] images=${files.length} ${(totalBytes / 1024).toFixed(0)}KB fast=${tFast}ms rejected=not-a-receipt`,
      );
      return fast;
    }

    // The app shows an editable draft, so the user reviews/fixes low-confidence
    // fields - no need to pay the ~2x latency of the accurate pass there. Auto-
    // saved channels (WhatsApp) have no review step, so they still escalate.
    const allowEscalation = ctx.channel !== ReceiptSource.APP;

    if (fast.confidence >= this.confidenceThreshold || !allowEscalation) {
      this.logger.log(
        `[scan] images=${files.length} ${(totalBytes / 1024).toFixed(0)}KB fast=${tFast}ms conf=${fast.confidence} escalated=${allowEscalation ? 'no' : 'skipped-app'}`,
      );
      return fast;
    }

    // Low confidence - retry once on the stronger model.
    this.logger.log(
      `Confidence ${fast.confidence} < ${this.confidenceThreshold}; escalating to ${ACCURATE_MODEL}`,
    );
    const tEsc = Date.now();
    try {
      const accurate = await this.run(ACCURATE_MODEL, shrunk, ctx);
      this.logger.log(
        `[scan] images=${files.length} ${(totalBytes / 1024).toFixed(0)}KB fast=${tFast}ms accurate=${Date.now() - tEsc}ms total=${Date.now() - t0}ms escalated=yes`,
      );
      return accurate;
    } catch (err) {
      this.logger.warn(
        `Escalation failed, using fast result: ${(err as Error).message}`,
      );
      return fast;
    }
  }

  /**
   * Shrink each image for the model payload: auto-rotate by EXIF, cap the long
   * edge at MAX_EDGE_PX (never upscale), re-encode as JPEG. Cuts vision tokens.
   * On any failure for a given file, falls back to the original buffer so a
   * quirky image never blocks extraction.
   */
  private async downscaleAll(
    files: { buffer: Buffer; mimetype: string }[],
  ): Promise<{ buffer: Buffer; mimetype: string }[]> {
    return Promise.all(
      files.map(async (f) => {
        try {
          const buffer = await sharp(f.buffer)
            .rotate() // honour EXIF orientation before stripping metadata
            .resize({
              width: this.maxEdgePx,
              height: this.maxEdgePx,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .jpeg({ quality: JPEG_QUALITY })
            .toBuffer();
          return { buffer, mimetype: 'image/jpeg' };
        } catch (err) {
          this.logger.warn(
            `Downscale failed, using original: ${(err as Error).message}`,
          );
          return f;
        }
      }),
    );
  }

  private async run(
    model: string,
    files: { buffer: Buffer; mimetype: string }[],
    ctx: ExtractionContext,
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
        ? `These ${files.length} images are sequential top-to-bottom sections of ONE single receipt (a long receipt photographed in parts). Combine them and extract the receipt exactly once - merge all line items in order and use the grand total from the final section.`
        : 'Extract this receipt.';

    let message: Anthropic.Message;
    const apiStart = Date.now();
    try {
      message = await this.client.messages.create({
        model,
        max_tokens: 2048,
        // Cache the system prompt + tool schema - identical on every call.
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

    // model-only latency + token usage, to separate model time from network/encoding.
    const u = message.usage;
    this.logger.log(
      `[scan] ${model} api=${Date.now() - apiStart}ms in=${u.input_tokens} out=${u.output_tokens} cacheRead=${u.cache_read_input_tokens ?? 0} cacheWrite=${u.cache_creation_input_tokens ?? 0}`,
    );

    // Persist token usage + cost for the admin dashboard. Fire-and-forget;
    // record() swallows its own errors so it never breaks extraction.
    void this.aiUsage.record({
      userId: ctx.userId,
      channel: ctx.channel,
      model,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    });

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
      // Default complete=true (only an explicit false flags a partial capture);
      // multipleReceipts=false unless the model explicitly flags distinct receipts.
      complete: raw.complete !== false,
      multipleReceipts: raw.multipleReceipts === true,
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
