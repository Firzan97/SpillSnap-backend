import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/** An Expo push token for one of a user's devices. */
@Entity('push_tokens')
@Unique(['token'])
export class PushToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Column()
  token: string; // ExponentPushToken[...]

  @Column({ default: 'ios' })
  platform: string; // ios | android

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
