import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import {
  PricingController,
  StripeWebhookController,
  SubscriptionController,
} from './billing.controller';
import { BillingService } from './billing.service';
import { AiUsage } from './entities/ai-usage.entity';
import { DailyUsage } from './entities/daily-usage.entity';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionEvent } from './entities/subscription-event.entity';
import { AiUsageService } from './ai-usage.service';
import { EntitlementService } from './entitlement.service';
import { DailyQuotaGuard } from './guards/daily-quota.guard';
import { StripeService } from './stripe.service';
import { UsageService } from './usage.service';
import { WhatsappSenderModule } from '../whatsapp/whatsapp-sender.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Subscription,
      SubscriptionEvent,
      DailyUsage,
      AiUsage,
    ]),
    UsersModule,
    WhatsappSenderModule,
  ],
  controllers: [
    PricingController,
    SubscriptionController,
    StripeWebhookController,
  ],
  providers: [
    BillingService,
    EntitlementService,
    UsageService,
    AiUsageService,
    StripeService,
    DailyQuotaGuard,
  ],
  // Exported so ReceiptsModule can apply the quota guard on capture and record
  // AI usage during extraction.
  exports: [EntitlementService, UsageService, AiUsageService, DailyQuotaGuard],
})
export class BillingModule {}
