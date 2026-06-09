import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { EntitlementService } from '../billing/entitlement.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { UsersService } from '../users/users.service';
import { WhatsappSenderService } from './whatsapp-sender.service';

/** Auto-finalize a batch this long after the last image arrives (ms). */
const IDLE_FINALIZE_MS = 90_000;
const MAX_IMAGES = 6; // sections of one long receipt
const DONE_WORDS = new Set([
  'no',
  'no more',
  'nomore',
  'done',
  'thats all',
  "that's all",
  'finish',
  'finished',
  'stop',
  'end',
]);

interface PendingBatch {
  userId: string;
  files: { buffer: Buffer; mimetype: string }[];
  timer: NodeJS.Timeout;
}

/** Minimal shapes of the Meta webhook payload we read. */
interface WaMessage {
  from?: string;
  type?: string;
  image?: { id?: string };
  text?: { body?: string };
}
interface WaWebhookBody {
  entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[];
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  /** In-memory batch buffer keyed by sender wa_id. Single-instance only. */
  private readonly pending = new Map<string, PendingBatch>();

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly entitlement: EntitlementService,
    private readonly receipts: ReceiptsService,
    private readonly sender: WhatsappSenderService,
  ) {}

  private get verifyToken() {
    return this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
  }
  private get appSecret() {
    return this.config.get<string>('WHATSAPP_APP_SECRET');
  }

  // ── Webhook verification (GET) ──────────────────────────────────────────────
  verifyWebhook(
    mode?: string,
    token?: string,
    challenge?: string,
  ): string | null {
    if (mode === 'subscribe' && token && token === this.verifyToken) {
      return challenge ?? '';
    }
    return null;
  }

  /** Validate Meta's X-Hub-Signature-256 against the raw body (if app secret set). */
  verifySignature(rawBody: Buffer | undefined, signature?: string): boolean {
    if (!this.appSecret) return true; // not configured → skip
    if (!rawBody || !signature) return false;
    const expected =
      'sha256=' +
      createHmac('sha256', this.appSecret).update(rawBody).digest('hex');
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ── Incoming messages (POST) ────────────────────────────────────────────────
  async handleWebhook(payload: unknown): Promise<void> {
    if (!this.sender.enabled) return;
    const body = payload as WaWebhookBody;
    const entries = body?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        for (const msg of change?.value?.messages ?? []) {
          try {
            await this.handleMessage(msg);
          } catch (e) {
            this.logger.error(`handleMessage failed: ${(e as Error).message}`);
          }
        }
      }
    }
  }

  private async handleMessage(msg: WaMessage): Promise<void> {
    const from: string | undefined = msg?.from;
    if (!from) return;

    // Resolve + gate the sender on their first message of a batch.
    let batch = this.pending.get(from);
    if (!batch) {
      const user = await this.users.findByPhoneDigits(from);
      if (!user) {
        await this.sender.sendText(
          from,
          "👋 This number isn't linked to a SpillSnap account. Open the app → Profile → Account & security and add this WhatsApp number, then try again.",
        );
        return;
      }
      const ent = await this.entitlement.resolve(user);
      if (!ent.isPro) {
        await this.sender.sendText(
          from,
          '📸 Sending receipts over WhatsApp is a SpillSnap Pro feature. Upgrade in the app to unlock it.',
        );
        return;
      }
      batch = { userId: user.id, files: [], timer: this.armTimer(from) };
    }

    if (msg.type === 'image' && msg.image?.id) {
      if (batch.files.length >= MAX_IMAGES) {
        await this.sender.sendText(
          from,
          `You can send up to ${MAX_IMAGES} images per receipt. Reply DONE to process them.`,
        );
        return;
      }
      const media = await this.sender.downloadMedia(msg.image.id);
      if (!media) {
        await this.sender.sendText(
          from,
          "Sorry, I couldn't download that image. Please resend it.",
        );
        return;
      }
      batch.files.push(media);
      this.resetTimer(from, batch);
      this.pending.set(from, batch);
      await this.sender.sendText(
        from,
        `Got image ${batch.files.length}. 📎 Send the next section if it's a long receipt, or reply *DONE* to process.`,
      );
      return;
    }

    if (msg.type === 'text') {
      const text: string = (msg.text?.body ?? '').trim().toLowerCase();
      if (DONE_WORDS.has(text)) {
        await this.finalize(from);
      } else {
        await this.sender.sendText(
          from,
          '📸 Send a photo of your receipt. For a long receipt, send each section as a separate photo, then reply *DONE*.',
        );
      }
      return;
    }

    await this.sender.sendText(from, '📸 Please send your receipt as a photo.');
  }

  // ── Batch lifecycle ─────────────────────────────────────────────────────────
  private armTimer(from: string): NodeJS.Timeout {
    return setTimeout(() => {
      void this.finalize(from);
    }, IDLE_FINALIZE_MS);
  }

  private resetTimer(from: string, batch: PendingBatch): void {
    clearTimeout(batch.timer);
    batch.timer = this.armTimer(from);
  }

  private async finalize(from: string): Promise<void> {
    const batch = this.pending.get(from);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.pending.delete(from);

    if (batch.files.length === 0) return;

    const user = await this.users.findById(batch.userId).catch(() => null);
    if (!user) return;

    await this.sender.sendText(from, '⏳ Reading your receipt…');
    try {
      const result = await this.receipts.captureAndSave(user, batch.files);
      if (!result.isReceipt) {
        await this.sender.sendText(
          from,
          `⚠️ ${result.reason ?? "That doesn't look like a receipt."} Please resend a clear photo.`,
        );
        return;
      }
      const r = result.receipt;
      await this.sender.sendText(
        from,
        `✅ Saved! *${r.merchant}* — ${r.currency} ${Number(r.amount).toFixed(2)}\nView it in the SpillSnap app.`,
      );
    } catch (e) {
      this.logger.error(
        `finalize/captureAndSave failed: ${(e as Error).message}`,
      );
      await this.sender.sendText(
        from,
        '😕 Something went wrong saving that. Please try again.',
      );
    }
  }
}
