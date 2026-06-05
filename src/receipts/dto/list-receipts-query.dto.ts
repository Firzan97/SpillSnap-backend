import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ReceiptCategory } from '../entities/receipt.entity';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

export class ListReceiptsQueryDto {
  @ApiPropertyOptional({ enum: ReceiptCategory })
  @IsOptional()
  @IsEnum(ReceiptCategory)
  category?: ReceiptCategory;

  @ApiPropertyOptional({ description: 'Only tax-eligible receipts' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  taxEligible?: boolean;

  @ApiPropertyOptional({ description: 'Only bookmarked receipts' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  bookmarked?: boolean;

  @ApiPropertyOptional({ description: 'Search merchant / tags' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'From date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'To date (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
