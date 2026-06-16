import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import type { AnalyticsRange } from '../analytics.service';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    enum: ['6m', '12m', 'ya', 'all', 'month', 'custom'],
    default: '12m',
    description: 'Time window for the analytics aggregation.',
  })
  @IsOptional()
  @IsEnum(['6m', '12m', 'ya', 'all', 'month', 'custom'])
  range?: AnalyticsRange = '12m';

  @ApiPropertyOptional({ description: 'Start date (ISO) for range=custom.' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'End date (ISO) for range=custom. Defaults to now.',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
