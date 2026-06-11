import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum ReceiptCategory {
  GROCERIES = 'groceries',
  DINING = 'dining',
  TRANSPORT = 'transport',
  SHOPPING = 'shopping',
  SPORTS = 'sports',
  BILLS = 'bills',
  MEDICAL = 'medical',
  BOOKS = 'books',
  OTHER = 'other',
}

export enum LhdnRelief {
  LIFESTYLE = 'lifestyle', // S46(1)(p) lifestyle - RM2,500 (shared: books, computers, internet, courses)
  BOOKS = 'books', // claimed WITHIN the lifestyle cap, not separate - see relief-rules.config.ts
  SPORTS = 'sports', // S46(1)(p) sports - RM1,000 (additional, on top of lifestyle)
  MEDICAL = 'medical', // S46(1)(d) - RM10,000
  EV_CHARGING = 'ev_charging', // RM2,500
  BREASTFEEDING = 'breastfeeding', // RM1,000, once per 2 years
  CHILDCARE = 'childcare', // childcare centre / kindergarten fees - RM3,000
  EDUCATION = 'education', // self education fees - RM7,000
  NONE = 'none',
}

export enum ReceiptStatus {
  DRAFT = 'draft', // extracted, awaiting user confirmation
  CONFIRMED = 'confirmed', // saved by the user
}

export interface LineItem {
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
}

@Entity('receipts')
export class Receipt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @Index()
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  merchant: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number; // grand total

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  subtotal: number | null; // pre-tax total

  @Column({ default: 'MYR', length: 3 })
  currency: string; // the receipt's own currency

  // ── Base-currency conversion (computed from the user's base_currency) ──────────
  @Column({ name: 'base_currency', type: 'varchar', length: 3, nullable: true })
  baseCurrency: string | null;

  // Grand total expressed in the user's base currency (for cross-currency totals).
  @Column({
    name: 'base_amount',
    type: 'decimal',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  baseAmount: number | null;

  // Multiplier used: baseAmount = amount * fxRate. 1 when currency === base.
  @Column({
    name: 'fx_rate',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  fxRate: number | null;

  @Column({
    type: 'enum',
    enum: ReceiptCategory,
    default: ReceiptCategory.OTHER,
  })
  category: ReceiptCategory;

  @Column({ name: 'receipt_date', type: 'timestamptz' })
  receiptDate: Date; // purchase date + time from the receipt

  @Column({
    type: 'enum',
    enum: ReceiptStatus,
    default: ReceiptStatus.CONFIRMED,
  })
  status: ReceiptStatus;

  @Column({ default: false })
  bookmarked: boolean;

  @Column({ name: 'tax_eligible', default: false })
  taxEligible: boolean;

  @Column({
    name: 'lhdn_relief',
    type: 'enum',
    enum: LhdnRelief,
    default: LhdnRelief.NONE,
  })
  lhdnRelief: LhdnRelief;

  @Column({ name: 'relief_source', type: 'varchar', nullable: true })
  reliefSource: 'user' | 'ocr' | 'backfill' | null; // provenance of lhdnRelief

  @Column({ name: 'relief_confidence', type: 'smallint', nullable: true })
  reliefConfidence: number | null; // 0-100, for AI-applied relief tags

  @Column({ type: 'simple-array', nullable: true })
  tags: string[] | null;

  @Column({ name: 'line_items', type: 'jsonb', nullable: true })
  lineItems: LineItem[] | null;

  @Column({ name: 'image_url', type: 'varchar', nullable: true })
  imageUrl: string | null; // primary/first section path (kept for back-compat)

  @Column({ name: 'image_paths', type: 'simple-array', nullable: true })
  imagePaths: string[] | null; // all uploaded section paths (long receipts)

  @Column({ type: 'smallint', nullable: true })
  confidence: number | null; // OCR confidence 0-100

  @Column({
    name: 'sst_amount',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  sstAmount: number | null;

  @Column({ name: 'location', type: 'varchar', nullable: true })
  location: string | null;

  @Column({ name: 'payment_method', type: 'varchar', nullable: true })
  paymentMethod: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'raw_text', type: 'text', nullable: true })
  rawText: string | null; // raw OCR / model output, for audit + re-parse

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
