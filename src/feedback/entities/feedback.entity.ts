import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A customer testimonial shown on the public marketing site
 * ("Loved by people who hate doing taxes."). Curated/moderated — only rows with
 * `approved = true` are served publicly, so quotes can be drafted before going
 * live. No FK to users: the display name/role are stored denormalized so a quote
 * survives the account it came from and can be lightly edited for the site.
 */
@Entity('feedback')
export class Feedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  quote: string;

  @Column()
  name: string; // display name, e.g. "Hafiz M."

  @Column({ default: '' })
  role: string; // e.g. "F&B owner · Penang"

  // Optional presentation overrides — derived from `name` when left blank so the
  // minimum a quote needs is { quote, name }.
  @Column({ name: 'avatar_color', default: '' })
  avatarColor: string; // hex, e.g. "#A78BFA"

  @Column({ default: '' })
  initials: string; // e.g. "HM"

  @Column({ type: 'int', default: 5 })
  rating: number; // 1-5 stars

  // Only approved quotes are public. Defaults false so new rows are drafts.
  @Index()
  @Column({ default: false })
  approved: boolean;

  // Lower shows first; ties broken by newest. Lets the site be hand-ordered.
  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
