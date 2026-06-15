import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { AiUsage } from './billing/entities/ai-usage.entity';
import { DailyUsage } from './billing/entities/daily-usage.entity';
import { AppConfig } from './config/entities/app-config.entity';
import { AppConfigModule } from './config/app-config.module';
import { Subscription } from './billing/entities/subscription.entity';
import { SubscriptionEvent } from './billing/entities/subscription-event.entity';
import { DashboardModule } from './dashboard/dashboard.module';
import { Export } from './export/entities/export.entity';
import { ExportModule } from './export/export.module';
import { Feedback } from './feedback/entities/feedback.entity';
import { FeedbackModule } from './feedback/feedback.module';
import { FilterPreset } from './filter-presets/entities/filter-preset.entity';
import { FilterPresetsModule } from './filter-presets/filter-presets.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { Notification } from './notifications/entities/notification.entity';
import { NotificationsModule } from './notifications/notifications.module';
import { PublicStatsModule } from './public-stats/public-stats.module';
import { PushToken } from './push/entities/push-token.entity';
import { PushModule } from './push/push.module';
import { Receipt } from './receipts/entities/receipt.entity';
import { UserTag } from './settings/entities/user-tag.entity';
import { SettingsModule } from './settings/settings.module';
import { TaxModule } from './tax/tax.module';
import { User } from './users/entities/user.entity';
import { UsersModule } from './users/users.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USER', 'spendsnap'),
        password: config.get('DB_PASS', 'password'),
        database: config.get('DB_NAME', 'spendsnap'),
        entities: [
          User,
          Receipt,
          Subscription,
          SubscriptionEvent,
          DailyUsage,
          AiUsage,
          AppConfig,
          Export,
          Notification,
          UserTag,
          Feedback,
          FilterPreset,
          PushToken,
        ],
        // use migrations in production instead of synchronize
        synchronize: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') === 'development',
        ssl: /supabase\.com/.test(config.get('DATABASE_URL') ?? '')
          ? { rejectUnauthorized: false }
          : config.get('NODE_ENV') === 'production'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),

    AppConfigModule,
    UsersModule,
    AuthModule,
    AdminModule,
    DashboardModule,
    AnalyticsModule,
    LeaderboardModule,
    PublicStatsModule,
    BillingModule,
    ExportModule,
    FeedbackModule,
    FilterPresetsModule,
    PushModule,
    SettingsModule,
    NotificationsModule,
    WhatsappModule,
    TaxModule,
  ],
})
export class AppModule {}
