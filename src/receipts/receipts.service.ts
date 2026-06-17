import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import {
  LhdnRelief,
  Receipt,
  ReceiptSource,
  ReceiptStatus,
} from './entities/receipt.entity';
import { CreateReceiptDto } from './dto/create-receipt.dto';
import { UpdateReceiptDto } from './dto/update-receipt.dto';
import { ListReceiptsQueryDto } from './dto/list-receipts-query.dto';
import { StorageService } from './services/storage.service';
import {
  ExtractedReceipt,
  ReceiptExtractionService,
} from './services/receipt-extraction.service';
import { UsageService } from '../billing/usage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CurrencyService } from '../currency/currency.service';

const STREAK_MILESTONES = new Set([3, 7, 14, 30, 60, 100, 365]);

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReceiptsService {
  constructor(
    @InjectRepository(Receipt)
    private readonly repo: Repository<Receipt>,
    private readonly storage: StorageService,
    private readonly extraction: ReceiptExtractionService,
    private readonly usersService: UsersService,
    private readonly usage: UsageService,
    private readonly notifications: NotificationsService,
    private readonly currency: CurrencyService,
  ) {}

  /** Fill baseCurrency/baseAmount/fxRate on a receipt from the user's base currency. */
  private async applyConversion(receipt: Receipt, user: User): Promise<void> {
    const base = user.baseCurrency || 'MYR';
    const { baseAmount, fxRate } = await this.currency.convert(
      Number(receipt.amount),
      receipt.currency || base,
      base,
    );
    receipt.baseCurrency = base;
    receipt.baseAmount = baseAmount;
    receipt.fxRate = fxRate;
  }

  // ── Capture: upload + extract, return an UNSAVED draft ───────────────────────
  // Accepts one or more images (sections of a long receipt). They're merged into
  // a single extracted receipt; the first image is stored as the primary thumbnail.
  async capture(user: User, files: { buffer: Buffer; mimetype: string }[]) {
    try {
      return await this.captureInner(user, files);
    } catch (err) {
      // The quota guard reserves today's Free slot up front. A failed scan -
      // not-a-receipt, OCR/AI error, or storage failure - must NOT consume it;
      // hand the slot back so only a successful scan counts against quota.
      // Best-effort: a refund failure must never mask the original error.
      try {
        await this.usage.refund(user.id);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  private async captureInner(
    user: User,
    files: { buffer: Buffer; mimetype: string }[],
  ) {
    // Extract BEFORE uploading so non-receipt images never hit storage.
    const extracted = await this.extraction.extract(files, {
      userId: user.id,
      channel: ReceiptSource.APP,
    });

    if (!extracted.isReceipt) {
      throw new UnprocessableEntityException({
        error: 'NOT_A_RECEIPT',
        message:
          extracted.rejectReason ??
          "That doesn't look like a receipt. Please capture a valid receipt.",
      });
    }

    // Store every section so nothing is lost; the first is the primary image.
    const paths = await Promise.all(
      files.map((f) => this.storage.uploadReceiptImage(user.id, f)),
    );
    const imagePath = paths[0];

    return {
      // echoed back by the client on POST /receipts
      imagePath,
      imagePaths: paths,
      imageUrl: await this.storage.getSignedUrl(imagePath),
      imageUrls: (
        await Promise.all(paths.map((p) => this.storage.getSignedUrl(p)))
      ).filter((u): u is string => !!u),
      merchant: extracted.merchant,
      amount: extracted.total,
      subtotal: extracted.subtotal,
      sstAmount: extracted.sstAmount,
      currency: extracted.currency,
      receiptDate: extracted.receiptDate,
      category: extracted.suggestedCategory,
      lhdnRelief: extracted.suggestedRelief,
      taxEligible: extracted.taxEligible,
      lineItems: extracted.items,
      location: extracted.location,
      paymentMethod: extracted.paymentMethod,
      confidence: extracted.confidence,
      // Detection flags + a ready-to-show prompt. Non-blocking: the draft is
      // returned either way; the client decides whether to warn the user.
      complete: extracted.complete,
      multipleReceipts: extracted.multipleReceipts,
      warning: this.captureWarning(extracted),
    };
  }

  /**
   * User-facing prompt when a capture looks off, or null when it's clean.
   * multipleReceipts takes priority over an incomplete capture.
   */
  private captureWarning(extracted: ExtractedReceipt): string | null {
    if (extracted.multipleReceipts) {
      return "Looks like there's more than one receipt here. For the most accurate result, capture one receipt at a time.";
    }
    if (!extracted.complete) {
      return "This looks like it might be only part of the receipt — we couldn't see the final total. If it's a long receipt, add the missing sections so the amounts are right.";
    }
    return null;
  }

  // ── Create: persist a confirmed receipt + bump streak ────────────────────────
  async create(user: User, dto: CreateReceiptDto) {
    const receipt = this.repo.create({
      userId: user.id,
      merchant: dto.merchant,
      amount: dto.amount,
      subtotal: dto.subtotal ?? null,
      sstAmount: dto.sstAmount ?? null,
      currency: dto.currency ?? 'MYR',
      category: dto.category,
      receiptDate: this.normalizeReceiptDate(dto.receiptDate),
      taxEligible: dto.taxEligible ?? false,
      lhdnRelief: dto.lhdnRelief ?? LhdnRelief.NONE,
      tags: dto.tags ?? null,
      lineItems: dto.lineItems ?? null,
      imageUrl: dto.imagePath ?? dto.imagePaths?.[0] ?? null,
      imagePaths: dto.imagePaths ?? (dto.imagePath ? [dto.imagePath] : null),
      location: dto.location ?? null,
      paymentMethod: dto.paymentMethod ?? null,
      notes: dto.notes ?? null,
      confidence: dto.confidence ?? null,
      rawText: dto.rawText ?? null,
      status: ReceiptStatus.CONFIRMED,
      source: ReceiptSource.APP,
    });

    await this.applyConversion(receipt, user);
    const saved = await this.repo.save(receipt);
    await this.bumpStreak(user);

    // Feed item for the notifications inbox.
    await this.notifications.notify(user.id, {
      type: 'receipt',
      emoji: '📸',
      title: 'Receipt saved',
      body: `${saved.merchant} · ${saved.currency} ${Number(saved.amount).toFixed(2)}`,
      data: { receiptId: saved.id },
    });

    return this.toResponse(saved);
  }

  // ── Ingestion (WhatsApp) helpers ─────────────────────────────────────────────
  // Split into analyze (extract only, no storage) + saveExtracted (persist a
  // pre-extracted result) so a channel can inspect the detection flags
  // (multipleReceipts / complete) and decide whether to prompt BEFORE saving -
  // without paying for the model call twice.

  /** Extract from image(s) without uploading or persisting anything. */
  async analyze(
    user: User,
    files: { buffer: Buffer; mimetype: string }[],
    channel: ReceiptSource = ReceiptSource.WHATSAPP,
  ): Promise<ExtractedReceipt> {
    return this.extraction.extract(files, { userId: user.id, channel });
  }

  /** Upload + persist a confirmed receipt from an already-extracted result. */
  async saveExtracted(
    user: User,
    files: { buffer: Buffer; mimetype: string }[],
    extracted: ExtractedReceipt,
    source: ReceiptSource = ReceiptSource.WHATSAPP,
  ): Promise<Awaited<ReturnType<ReceiptsService['toResponse']>>> {
    const paths = await Promise.all(
      files.map((f) => this.storage.uploadReceiptImage(user.id, f)),
    );

    const receipt = this.repo.create({
      userId: user.id,
      merchant: extracted.merchant,
      amount: extracted.total,
      subtotal: extracted.subtotal ?? null,
      sstAmount: extracted.sstAmount ?? null,
      currency: extracted.currency ?? 'MYR',
      category: extracted.suggestedCategory,
      receiptDate: this.normalizeReceiptDate(extracted.receiptDate ?? ''),
      taxEligible: extracted.taxEligible ?? false,
      lhdnRelief: extracted.suggestedRelief ?? LhdnRelief.NONE,
      lineItems: extracted.items ?? null,
      imageUrl: paths[0] ?? null,
      imagePaths: paths,
      location: extracted.location ?? null,
      paymentMethod: extracted.paymentMethod ?? null,
      confidence: extracted.confidence ?? null,
      status: ReceiptStatus.CONFIRMED,
      source,
    });

    await this.applyConversion(receipt, user);
    const saved = await this.repo.save(receipt);
    await this.bumpStreak(user);
    await this.notifications.notify(user.id, {
      type: 'receipt',
      emoji: '📸',
      title: 'Receipt saved',
      body: `${saved.merchant} · ${saved.currency} ${Number(saved.amount).toFixed(2)}`,
      data: { receiptId: saved.id, source },
    });

    return this.toResponse(saved);
  }

  // ── Streak summary: current/longest + last-7-days snap activity ──────────────
  async streak(user: User) {
    const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);

    // Window start = 6 days ago (so we cover today + the prior 6).
    const windowStart = new Date(now.getTime() - 6 * DAY_MS);
    windowStart.setHours(0, 0, 0, 0);

    const rows = await this.repo
      .createQueryBuilder('r')
      .select('r.created_at', 'createdAt')
      .where('r.user_id = :userId', { userId: user.id })
      .andWhere('r.created_at >= :start', { start: windowStart })
      .getRawMany<{ createdAt: Date }>();

    const activeKeys = new Set(
      rows.map((r) => new Date(r.createdAt).toISOString().slice(0, 10)),
    );

    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getTime() - (6 - i) * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      return {
        label: DAY_LABELS[d.getDay()],
        date: key,
        active: activeKeys.has(key),
        isToday: key === todayKey,
      };
    });

    return {
      current: user.streakCount ?? 0,
      longest: user.longestStreak ?? 0,
      week,
    };
  }

  // ── List with filters + pagination ───────────────────────────────────────────
  async list(user: User, query: ListReceiptsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.repo
      .createQueryBuilder('r')
      .where('r.user_id = :userId', { userId: user.id });

    if (query.category)
      qb.andWhere('r.category = :category', { category: query.category });
    if (query.taxEligible !== undefined)
      qb.andWhere('r.tax_eligible = :te', { te: query.taxEligible });
    if (query.bookmarked !== undefined)
      qb.andWhere('r.bookmarked = :bm', { bm: query.bookmarked });
    if (query.search)
      qb.andWhere('r.merchant ILIKE :q', { q: `%${query.search}%` });
    if (query.dateFrom)
      qb.andWhere('r.receipt_date >= :from', { from: query.dateFrom });
    if (query.dateTo)
      qb.andWhere('r.receipt_date <= :to', { to: query.dateTo });

    qb.orderBy('r.receipt_date', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    const data = await Promise.all(rows.map((r) => this.toResponse(r)));

    return { data, total, page, limit, pageCount: Math.ceil(total / limit) };
  }

  // ── Detail ───────────────────────────────────────────────────────────────────
  async findOne(user: User, id: string) {
    return this.toResponse(await this.getOwned(user, id));
  }

  // ── Update (edit fields / toggle bookmark) ───────────────────────────────────
  async update(user: User, id: string, dto: UpdateReceiptDto) {
    const receipt = await this.getOwned(user, id);

    const { imagePath, receiptDate, ...rest } = dto;
    Object.assign(receipt, rest);
    if (imagePath !== undefined) receipt.imageUrl = imagePath;
    if (receiptDate !== undefined) receipt.receiptDate = new Date(receiptDate);

    // Re-run conversion if the amount or currency may have changed.
    if (dto.amount !== undefined || dto.currency !== undefined) {
      await this.applyConversion(receipt, user);
    }

    return this.toResponse(await this.repo.save(receipt));
  }

  /**
   * Re-convert every receipt for a user into a (new) base currency. Called when
   * the user changes their base currency so all totals stay in one currency.
   */
  async recomputeBaseAmounts(user: User): Promise<void> {
    const receipts = await this.repo.find({ where: { userId: user.id } });
    for (const r of receipts) await this.applyConversion(r, user);
    if (receipts.length) await this.repo.save(receipts);
  }

  // ── Delete (row + every stored section image) ────────────────────────────────
  async remove(user: User, id: string): Promise<void> {
    const receipt = await this.getOwned(user, id);
    const paths = receipt.imagePaths?.length
      ? receipt.imagePaths
      : receipt.imageUrl
        ? [receipt.imageUrl]
        : [];
    await this.storage.removeMany(paths);
    await this.repo.remove(receipt);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  /**
   * OCR sometimes returns an unparseable or implausible date (a future date, or
   * a misread year). A receipt is always a past purchase, so fall back to "now"
   * for missing/invalid/future dates - otherwise the receipt silently lands
   * outside the user's "this month" views.
   */
  private normalizeReceiptDate(input: string): Date {
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() > Date.now()) {
      return new Date();
    }
    return parsed;
  }

  private async getOwned(user: User, id: string): Promise<Receipt> {
    const receipt = await this.repo.findOne({ where: { id, userId: user.id } });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }

  /** Daily snap streak: +1 if yesterday, hold if today, reset otherwise. */
  private async bumpStreak(user: User): Promise<void> {
    const now = new Date();
    const last = user.lastSnapAt ? new Date(user.lastSnapAt) : null;

    let streak = 1;
    if (last) {
      const startToday = Math.floor(now.getTime() / DAY_MS);
      const startLast = Math.floor(last.getTime() / DAY_MS);
      const diff = startToday - startLast;
      if (diff === 0) return; // already snapped today - nothing to update
      streak = diff === 1 ? user.streakCount + 1 : 1;
    }

    await this.usersService.update(user.id, {
      streakCount: streak,
      longestStreak: Math.max(user.longestStreak ?? 0, streak),
      lastSnapAt: now,
    });

    if (STREAK_MILESTONES.has(streak)) {
      await this.notifications.notify(user.id, {
        type: 'streak',
        emoji: '🔥',
        title: `${streak}-day streak!`,
        body: `You've snapped ${streak} days running. Keep it going to climb the leaderboard.`,
        data: { streak },
      });
    }
  }

  private async toResponse(r: Receipt) {
    return {
      id: r.id,
      merchant: r.merchant,
      amount: Number(r.amount),
      subtotal: r.subtotal !== null ? Number(r.subtotal) : null,
      sstAmount: r.sstAmount !== null ? Number(r.sstAmount) : null,
      currency: r.currency,
      baseCurrency: r.baseCurrency ?? r.currency,
      baseAmount:
        r.baseAmount !== null ? Number(r.baseAmount) : Number(r.amount),
      fxRate: r.fxRate !== null ? Number(r.fxRate) : 1,
      category: r.category,
      receiptDate: r.receiptDate,
      status: r.status,
      bookmarked: r.bookmarked,
      taxEligible: r.taxEligible,
      lhdnRelief: r.lhdnRelief,
      tags: r.tags ?? [],
      lineItems: r.lineItems ?? [],
      location: r.location ?? null,
      paymentMethod: r.paymentMethod ?? null,
      notes: r.notes ?? null,
      confidence: r.confidence ?? null,
      imageUrl: await this.storage.getSignedUrl(r.imageUrl ?? null),
      imageUrls: await this.signAll(r),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /** Signed URLs for every stored section; falls back to the single imageUrl. */
  private async signAll(r: Receipt): Promise<string[]> {
    const paths = r.imagePaths?.length
      ? r.imagePaths
      : r.imageUrl
        ? [r.imageUrl]
        : [];
    const urls = await Promise.all(
      paths.map((p) => this.storage.getSignedUrl(p)),
    );
    return urls.filter((u): u is string => !!u);
  }
}
