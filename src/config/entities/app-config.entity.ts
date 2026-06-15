import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Editable runtime settings, one row per key (e.g. 'pricing', 'relief_rules').
 * Lets admins change pricing / tax-relief policy live from the dashboard without
 * a redeploy. The value is the full JSON payload; services read it with a
 * code-level fallback so an unset key behaves exactly like today.
 */
@Entity('app_config')
export class AppConfig {
  @PrimaryColumn({ type: 'varchar' })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
