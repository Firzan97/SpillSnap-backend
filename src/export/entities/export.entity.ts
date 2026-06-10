import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum ExportFormat {
  CSV = 'csv',
  PDF = 'pdf', // reserved - not yet generated (Phase 1 ships CSV only)
}

/**
 * Metadata for a generated export. The file itself is NOT stored - an export is
 * fully reproducible from (format, date range, include flags), so re-download
 * regenerates it. This keeps the feature infra-free (no blob storage).
 */
@Entity('exports')
export class Export {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @Index()
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'enum', enum: ExportFormat, default: ExportFormat.CSV })
  format: ExportFormat;

  @Column()
  filename: string;

  @Column({ name: 'date_from', type: 'timestamptz', nullable: true })
  dateFrom: Date | null;

  @Column({ name: 'date_to', type: 'timestamptz', nullable: true })
  dateTo: Date | null;

  // Optional saved-filter selection (from a bookmarked filter preset), kept so a
  // re-download reproduces exactly the same receipt set.
  @Column({ type: 'simple-array', nullable: true })
  categories: string[] | null;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[] | null;

  @Column({ name: 'include_tags_notes', default: true })
  includeTagsNotes: boolean;

  @Column({ name: 'include_line_items', default: true })
  includeLineItems: boolean;

  @Column({ name: 'receipt_count', default: 0 })
  receiptCount: number;

  @Column({ name: 'byte_size', default: 0 })
  byteSize: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
