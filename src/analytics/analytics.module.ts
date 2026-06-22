import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [ReceiptsModule, BillingModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
