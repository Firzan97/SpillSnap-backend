import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * A saved receipt-filter preset ("bookmarked filter"). User-scoped and synced,
 * so a named filter combo survives reinstall and is shared across devices.
 */
@Entity('filter_presets')
@Unique(['userId', 'name'])
export class FilterPreset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  name: string;

  @Column({ default: 'All time' })
  year: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  categories: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  tags: string[];

  @Column({ default: false })
  bookmarked: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
