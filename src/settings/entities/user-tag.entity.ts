import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/** A user-defined tag, reusable when saving receipts (independent of usage). */
@Entity('user_tags')
@Unique(['userId', 'name'])
export class UserTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  name: string; // normalized, leading '#'

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
