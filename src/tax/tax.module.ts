import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Receipt } from '../receipts/entities/receipt.entity';
import { UsersModule } from '../users/users.module';
import { ReliefBackfillService } from './relief-backfill.service';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';

@Module({
  imports: [TypeOrmModule.forFeature([Receipt]), UsersModule],
  controllers: [TaxController],
  providers: [TaxService, ReliefBackfillService],
})
export class TaxModule {}
