import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { CurrencyModule } from '../currency/currency.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { Receipt } from './entities/receipt.entity';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { StorageService } from './services/storage.service';
import { ReceiptExtractionService } from './services/receipt-extraction.service';
import { ReceiptCleanupService } from './services/receipt-cleanup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Receipt]),
    UsersModule,
    BillingModule,
    NotificationsModule,
    CurrencyModule,
  ],
  controllers: [ReceiptsController],
  providers: [
    ReceiptsService,
    StorageService,
    ReceiptExtractionService,
    ReceiptCleanupService,
  ],
  exports: [TypeOrmModule, ReceiptsService],
})
export class ReceiptsModule {}
