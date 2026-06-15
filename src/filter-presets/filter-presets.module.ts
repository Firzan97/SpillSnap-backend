import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { UsersModule } from '../users/users.module';
import { FilterPreset } from './entities/filter-preset.entity';
import { FilterPresetsController } from './filter-presets.controller';
import { FilterPresetsService } from './filter-presets.service';

@Module({
  imports: [TypeOrmModule.forFeature([FilterPreset]), UsersModule, BillingModule],
  controllers: [FilterPresetsController],
  providers: [FilterPresetsService],
})
export class FilterPresetsModule {}
