import { Module } from '@nestjs/common';
import { ReceiptsModule } from '../receipts/receipts.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [ReceiptsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
