import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
} from 'class-validator';
import { ExportFormat } from '../entities/export.entity';

const toBool = ({ value }: { value: unknown }) =>
  value === undefined
    ? undefined
    : value === true || value === 'true' || value === '1';

/** Accept either a JSON array or a comma-separated string; drop empties. */
const toArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  const arr = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const cleaned = arr.map((v) => String(v).trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
};

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
    type: [String],
    description: 'Only export these receipt categories (from a saved filter).',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Only export receipts carrying any of these tags.',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

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
