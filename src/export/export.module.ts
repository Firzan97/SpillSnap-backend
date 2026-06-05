import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Receipt } from '../receipts/entities/receipt.entity';
import { UsersModule } from '../users/users.module';
import { Export } from './entities/export.entity';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [TypeOrmModule.forFeature([Export, Receipt]), UsersModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
