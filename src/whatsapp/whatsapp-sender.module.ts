import { Module } from '@nestjs/common';
import { WhatsappSenderService } from './whatsapp-sender.service';

/** Dependency-free outbound sender - importable anywhere without import cycles. */
@Module({
  providers: [WhatsappSenderService],
  exports: [WhatsappSenderService],
})
export class WhatsappSenderModule {}
