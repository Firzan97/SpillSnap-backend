import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import type { AnalyticsRange } from '../analytics.service';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    enum: ['6m', '12m', 'ya', 'all'],
    default: '12m',
    description: 'Time window for the analytics aggregation.',
  })
  @IsOptional()
  @IsEnum(['6m', '12m', 'ya', 'all'])
  range?: AnalyticsRange = '12m';
}
