import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { ExportFormat } from '../entities/export.entity';

const toBool = ({ value }: { value: unknown }) =>
  value === undefined
    ? undefined
    : value === true || value === 'true' || value === '1';

export class CreateExportDto {
  @ApiProperty({ enum: ExportFormat, default: ExportFormat.CSV })
  @IsEnum(ExportFormat)
  format: ExportFormat = ExportFormat.CSV;

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

  @ApiPropertyOptional({
    default: true,
    description: 'Include custom tags & notes columns',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeTagsNotes?: boolean = true;

  @ApiPropertyOptional({
    default: true,
    description: 'One row per line item instead of per receipt',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeLineItems?: boolean = true;
}
