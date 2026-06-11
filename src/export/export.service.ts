import {
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Receipt } from '../receipts/entities/receipt.entity';
import { User } from '../users/entities/user.entity';
import { CreateExportDto } from './dto/create-export.dto';
import { ExportSummaryQueryDto } from './dto/export-summary-query.dto';
import { Export, ExportFormat } from './entities/export.entity';

type CsvValue = string | number | boolean | null | undefined;

/** Receipt selection for an export: a date window plus optional category/tag filters. */
export interface ExportFilter {
  dateFrom?: string;
  dateTo?: string;
  categories?: string[];
  tags?: string[];
}

/** Quote a CSV field per RFC 4180 (wrap + double embedded quotes when needed). */
function csvCell(value: CsvValue): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: CsvValue[]): string {
  return cells.map(csvCell).join(',');
}

function ymd(d: Date): string {
  return new Date(d).toISOString().split('T')[0];
}

@Injectable()
export class ExportService {
  constructor(
    @InjectRepository(Receipt)
    private readonly receiptRepo: Repository<Receipt>,
    @InjectRepository(Export)
    private readonly exportRepo: Repository<Export>,
  ) {}

  /** Counts + total over the chosen filter - drives the summary card & button label. */
  async summary(user: User, q: ExportSummaryQueryDto) {
    const receipts = await this.fetchFiltered(user, q);
    const total = receipts.reduce(
      (sum, r) => sum + Number(r.baseAmount ?? r.amount),
      0,
    );

    return {
      receiptCount: receipts.length,
      total: Number(total.toFixed(2)),
      currency: 'MYR',
      dateFrom: q.dateFrom ?? null,
      dateTo: q.dateTo ?? null,
    };
  }

  /** Generate an export, persist its (reproducible) metadata, and return the file content. */
  async create(user: User, dto: CreateExportDto) {
    if (dto.format === ExportFormat.PDF) {
      throw new NotImplementedException(
        'PDF export is coming soon - use CSV for now.',
      );
    }

    const receipts = await this.fetchFiltered(user, dto);

    const includeTagsNotes = dto.includeTagsNotes ?? true;
    const includeLineItems = dto.includeLineItems ?? true;
    const csv = this.buildCsv(receipts, includeTagsNotes, includeLineItems);
    const content = Buffer.from(csv, 'utf-8');
    const filename = this.filename(dto.dateFrom, dto.dateTo);

    const row = await this.exportRepo.save(
      this.exportRepo.create({
        userId: user.id,
        format: ExportFormat.CSV,
        filename,
        dateFrom: dto.dateFrom ? new Date(dto.dateFrom) : null,
        dateTo: dto.dateTo ? new Date(dto.dateTo) : null,
        categories: dto.categories?.length ? dto.categories : null,
        tags: dto.tags?.length ? dto.tags : null,
        includeTagsNotes,
        includeLineItems,
        receiptCount: receipts.length,
        byteSize: content.byteLength,
      }),
    );

    return {
      id: row.id,
      filename,
      mimeType: 'text/csv',
      contentBase64: content.toString('base64'),
      size: content.byteLength,
      receiptCount: receipts.length,
    };
  }

  /** Recent exports for the re-download list. */
  async history(user: User) {
    const rows = await this.exportRepo.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      format: r.format,
      size: r.byteSize,
      receiptCount: r.receiptCount,
      createdAt: r.createdAt,
    }));
  }

  /** Re-download: regenerate from the saved parameters (no blob storage). */
  async download(user: User, id: string) {
    const row = await this.exportRepo.findOne({
      where: { id, userId: user.id },
    });
    if (!row) throw new NotFoundException('Export not found');

    const receipts = await this.fetchFiltered(user, {
      dateFrom: row.dateFrom?.toISOString(),
      dateTo: row.dateTo?.toISOString(),
      categories: row.categories ?? undefined,
      tags: row.tags ?? undefined,
    });

    const csv = this.buildCsv(
      receipts,
      row.includeTagsNotes,
      row.includeLineItems,
    );
    const content = Buffer.from(csv, 'utf-8');

    return {
      id: row.id,
      filename: row.filename,
      mimeType: 'text/csv',
      contentBase64: content.toString('base64'),
      size: content.byteLength,
      receiptCount: receipts.length,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  /**
   * Select receipts for an export. Date range + categories filter in SQL; tags
   * (a `simple-array` text column, not jsonb) are intersected in JS so partial
   * matches like "foo" vs "foobar" can't leak in.
   */
  private async fetchFiltered(
    user: User,
    f: ExportFilter,
  ): Promise<Receipt[]> {
    const qb = this.receiptRepo
      .createQueryBuilder('r')
      .where('r.user_id = :userId', { userId: user.id });
    if (f.dateFrom) qb.andWhere('r.receipt_date >= :from', { from: f.dateFrom });
    if (f.dateTo) qb.andWhere('r.receipt_date <= :to', { to: f.dateTo });
    if (f.categories?.length)
      qb.andWhere('r.category IN (:...categories)', {
        categories: f.categories,
      });
    qb.orderBy('r.receipt_date', 'DESC');

    const rows = await qb.getMany();
    if (f.tags?.length) {
      const want = new Set(f.tags);
      return rows.filter((r) => (r.tags ?? []).some((t) => want.has(t)));
    }
    return rows;
  }

  private buildCsv(
    receipts: Receipt[],
    includeTagsNotes: boolean,
    includeLineItems: boolean,
  ): string {
    const base = [
      'Date',
      'Merchant',
      'Category',
      'Subtotal',
      'SST',
      'Total',
      'Currency',
      'Tax eligible',
      'LHDN relief',
      'Payment method',
      'Location',
    ];
    const tail = includeTagsNotes ? ['Tags', 'Notes'] : [];
    const itemCols = includeLineItems
      ? ['Item', 'Qty', 'Unit price', 'Line total']
      : [];
    const header = [...base, ...itemCols, ...tail];

    const lines: string[] = [csvRow(header)];

    for (const r of receipts) {
      const baseCells = [
        ymd(r.receiptDate),
        r.merchant,
        r.category,
        r.subtotal ?? '',
        r.sstAmount ?? '',
        Number(r.amount),
        r.currency,
        r.taxEligible ? 'yes' : 'no',
        r.lhdnRelief,
        r.paymentMethod ?? '',
        r.location ?? '',
      ];
      const tailCells = includeTagsNotes
        ? [(r.tags ?? []).join(' '), r.notes ?? '']
        : [];

      if (includeLineItems && r.lineItems && r.lineItems.length > 0) {
        for (const item of r.lineItems) {
          lines.push(
            csvRow([
              ...baseCells,
              item.name,
              item.qty,
              item.unitPrice,
              item.total,
              ...tailCells,
            ]),
          );
        }
      } else {
        const emptyItem = includeLineItems ? ['', '', '', ''] : [];
        lines.push(csvRow([...baseCells, ...emptyItem, ...tailCells]));
      }
    }

    return lines.join('\n');
  }

  private filename(dateFrom?: string, dateTo?: string): string {
    if (dateFrom && dateTo) {
      return `spillsnap-${ymd(new Date(dateFrom))}_${ymd(new Date(dateTo))}.csv`;
    }
    return `spillsnap-all-${ymd(new Date())}.csv`;
  }
}
