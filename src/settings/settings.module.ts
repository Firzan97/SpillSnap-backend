import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Receipt } from '../receipts/entities/receipt.entity';
import { ReceiptsModule } from '../receipts/receipts.module';
import { StorageService } from '../receipts/services/storage.service';
import { UsersModule } from '../users/users.module';
import { UserTag } from './entities/user-tag.entity';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Receipt, UserTag]),
    UsersModule,
    ReceiptsModule,
  ],
  controllers: [SettingsController],
  providers: [SettingsService, StorageService],
})
export class SettingsModule {}
