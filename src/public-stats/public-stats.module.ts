import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from '../billing/entities/subscription.entity';
import { Receipt } from '../receipts/entities/receipt.entity';
import { User } from '../users/entities/user.entity';
import { PublicStatsController } from './public-stats.controller';
import { PublicStatsService } from './public-stats.service';

@Module({
  imports: [TypeOrmModule.forFeature([Receipt, User, Subscription])],
  controllers: [PublicStatsController],
  providers: [PublicStatsService],
})
export class PublicStatsModule {}
