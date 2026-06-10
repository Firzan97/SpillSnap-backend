import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  FREE = 'free',
  PRO = 'pro',
  ADMIN = 'admin',
}

export enum AuthProvider {
  EMAIL = 'email',
  GOOGLE = 'google',
}

/** Notification preferences (settings → Notifications). */
export interface NotificationPrefs {
  channels: { push: boolean };
  prefs: Record<string, boolean>; // keyed by pref id, e.g. snap, streak, weekly…
  quietHours: { enabled: boolean; from: string; to: string };
}

/** Security preferences (settings → Account & security). */
export interface SecurityPrefs {
  faceIdUnlock: boolean;
}

/**
 * Optional manual (non-receipt) relief inputs, keyed by Year of Assessment.
 * Each YA maps field key → raw numeric value (RM for amounts, 0/1 for toggles,
 * a count for dependents). See relief-manual.config.ts.
 */
export type ManualReliefs = Record<string, Record<string, number>>;

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null; // Malaysian +60 format

  @Column()
  name: string;

  // Clerk is the source of truth for credentials. This maps the Clerk user id
  // ("sub" claim, e.g. user_2abc…) to our local profile row.
  @Column({ name: 'clerk_id', type: 'varchar', unique: true, nullable: true })
  clerkId: string | null;

  @Column({
    name: 'auth_provider',
    type: 'enum',
    enum: AuthProvider,
    default: AuthProvider.EMAIL,
  })
  authProvider: AuthProvider;

  @Column({ name: 'provider_id', type: 'varchar', nullable: true })
  providerId: string | null; // Google "sub"

  @Column({ name: 'avatar_url', type: 'varchar', nullable: true })
  avatarUrl: string | null;

  // Base/display currency (ISO 4217). Foreign receipts convert into this.
  @Column({ name: 'base_currency', length: 3, default: 'MYR' })
  baseCurrency: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.FREE })
  role: UserRole;

  @Column({ name: 'trial_ends_at', nullable: true, type: 'timestamptz' })
  trialEndsAt: Date;

  @Column({ name: 'streak_count', default: 0 })
  streakCount: number;

  @Column({ name: 'longest_streak', default: 0 })
  longestStreak: number;

  @Column({ name: 'last_snap_at', nullable: true, type: 'timestamptz' })
  lastSnapAt: Date;

  @Column({ name: 'has_unread_notifications', default: false })
  hasUnreadNotifications: boolean;

  @Column({
    name: 'monthly_budget',
    nullable: true,
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  monthlyBudget: number;

  // Settings prefs (jsonb; defaults applied in SettingsService when null).
  @Column({ name: 'notification_prefs', type: 'jsonb', nullable: true })
  notificationPrefs: NotificationPrefs | null;

  @Column({ name: 'security_prefs', type: 'jsonb', nullable: true })
  securityPrefs: SecurityPrefs | null;

  // Optional manual relief inputs, keyed by YA (settings applied in TaxService).
  @Column({ name: 'manual_reliefs', type: 'jsonb', nullable: true })
  manualReliefs: ManualReliefs | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
