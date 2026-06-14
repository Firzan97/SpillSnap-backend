import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiUsage } from '../billing/entities/ai-usage.entity';
import { Subscription } from '../billing/entities/subscription.entity';
import { Receipt } from '../receipts/entities/receipt.entity';
import { User } from '../users/entities/user.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Receipt, Subscription, AiUsage]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
