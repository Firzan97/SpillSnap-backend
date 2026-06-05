import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

export class ExportSummaryQueryDto {
  @ApiPropertyOptional({
    description: 'From date (ISO 8601). Omit for all-time.',
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'To date (ISO 8601). Omit for all-time.',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
