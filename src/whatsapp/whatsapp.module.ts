import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { UsersModule } from '../users/users.module';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappSenderModule } from './whatsapp-sender.module';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [UsersModule, BillingModule, ReceiptsModule, WhatsappSenderModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
})
export class WhatsappModule {}
