import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LhdnRelief,
  Receipt,
  ReceiptStatus,
} from '../receipts/entities/receipt.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  ManualReliefItemDto,
  ReliefBucketSummaryDto,
  ReliefSummaryResponseDto,
} from './dto/relief-summary-response.dto';
import {
  manualClaimable,
  manualReliefFieldsForYa,
} from './relief-manual.config';
import {
  bucketForRelief,
  resolveFilingPeriod,
  rulesForYa,
} from './relief-rules.config';

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class TaxService {
  constructor(
    @InjectRepository(Receipt)
    private readonly receipts: Repository<Receipt>,
    private readonly users: UsersService,
  ) {}

  /**
   * Relief progress for a Year of Assessment: how much the user has spent in
   * each relief bucket vs its cap. Computed live — receipts only store the
   * relief tag + amount; the caps come from the versioned rules for that YA.
   */
  async getReliefSummary(
    user: User,
    ya?: number,
  ): Promise<ReliefSummaryResponseDto> {
    const period = resolveFilingPeriod();
    const targetYa = ya ?? period.ya;
    const rules = rulesForYa(targetYa);

    // YA = calendar year in Malaysia time. Offset-aware bounds so receipts near
    // the year boundary land in the correct YA regardless of stored timezone.
    const from = new Date(`${targetYa}-01-01T00:00:00+08:00`);
    const to = new Date(`${targetYa + 1}-01-01T00:00:00+08:00`);

    const rows = await this.receipts
      .createQueryBuilder('r')
      .select('r.lhdn_relief', 'relief')
      .addSelect('SUM(COALESCE(r.base_amount, r.amount))', 'spent')
      .addSelect('COUNT(*)', 'count')
      .where('r.user_id = :uid', { uid: user.id })
      .andWhere('r.status = :status', { status: ReceiptStatus.CONFIRMED })
      .andWhere('r.lhdn_relief != :none', { none: LhdnRelief.NONE })
      .andWhere('r.receipt_date >= :from', { from })
      .andWhere('r.receipt_date < :to', { to })
      .groupBy('r.lhdn_relief')
      .getRawMany<{ relief: LhdnRelief; spent: string; count: string }>();

    // Fold each relief tag into its bucket (books → lifestyle, etc.).
    const byBucket = new Map<string, { spent: number; count: number }>();
    for (const row of rows) {
      const bucket = bucketForRelief(rules, row.relief);
      if (!bucket) continue; // tag not claimable this YA — keep receipt, count RM0
      const acc = byBucket.get(bucket.key) ?? { spent: 0, count: 0 };
      acc.spent += Number(row.spent);
      acc.count += Number(row.count);
      byBucket.set(bucket.key, acc);
    }

    const buckets: ReliefBucketSummaryDto[] = rules.buckets.map((b) => {
      const acc = byBucket.get(b.key) ?? { spent: 0, count: 0 };
      const spent = round2(acc.spent);
      const claimable = round2(Math.min(spent, b.cap));
      return {
        key: b.key,
        label: b.label,
        section: b.section,
        cap: b.cap,
        spent,
        claimable,
        remaining: round2(Math.max(b.cap - claimable, 0)),
        pct: b.cap ? Math.round((claimable / b.cap) * 100) : 0,
        receiptCount: acc.count,
      };
    });

    // Optional manual (non-receipt) reliefs the user has entered for this YA.
    const stored = user.manualReliefs?.[String(targetYa)] ?? {};
    const manualReliefs: ManualReliefItemDto[] = manualReliefFieldsForYa(
      targetYa,
    ).map((f) => {
      const value = Number(stored[f.key] ?? 0);
      return {
        key: f.key,
        label: f.label,
        hint: f.hint,
        group: f.group,
        type: f.type,
        cap: f.cap ?? null,
        amount: f.amount ?? null,
        perUnit: f.perUnit ?? null,
        value,
        claimable: round2(manualClaimable(f, value)),
      };
    });

    const receiptClaimable = buckets.reduce((sum, b) => sum + b.claimable, 0);
    const manualClaimableTotal = manualReliefs.reduce(
      (sum, m) => sum + m.claimable,
      0,
    );
    const totalClaimable = round2(receiptClaimable + manualClaimableTotal);

    return {
      ya: targetYa,
      status: rules.status,
      mode: period.mode,
      // Deadline to file THIS YA = Apr 30 of the following year.
      deadline: `${targetYa + 1}-04-30`,
      disclaimer:
        rules.status === 'provisional'
          ? `Estimated using the latest confirmed LHDN figures — YA${targetYa} reliefs are not finalised yet.`
          : null,
      buckets,
      manualReliefs,
      manualClaimable: round2(manualClaimableTotal),
      totalClaimable,
    };
  }

  /**
   * Upsert the user's optional manual relief values for a YA, then return the
   * recomputed summary. Only known field keys are persisted; unknown keys and
   * negative/NaN values are dropped.
   */
  async updateManualReliefs(
    user: User,
    ya: number | undefined,
    values: Record<string, number>,
  ): Promise<ReliefSummaryResponseDto> {
    const targetYa = ya ?? resolveFilingPeriod().ya;
    const allowed = new Set(manualReliefFieldsForYa(targetYa).map((f) => f.key));

    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(values ?? {})) {
      if (!allowed.has(k)) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) clean[k] = n;
    }

    const next = { ...(user.manualReliefs ?? {}) };
    next[String(targetYa)] = clean;
    const updated = await this.users.update(user.id, { manualReliefs: next });

    return this.getReliefSummary(updated, targetYa);
  }
}
