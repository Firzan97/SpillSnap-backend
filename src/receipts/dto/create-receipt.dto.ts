import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { LhdnRelief, ReceiptCategory } from '../entities/receipt.entity';
import { LineItemDto } from './line-item.dto';

/**
 * Body for confirming/saving a receipt after the capture step.
 * Carries the (possibly user-edited) extracted fields plus the storage path
 * of the image uploaded during capture.
 */
export class CreateReceiptDto {
  @ApiProperty({ example: 'Decathlon Malaysia' })
  @IsString()
  merchant: string;

  @ApiProperty({ description: 'Grand total paid', example: 460.08 })
  @IsNumber()
  amount: number;

  @ApiPropertyOptional({ description: 'Pre-tax total', example: 426.0 })
  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @ApiPropertyOptional({ example: 34.08 })
  @IsOptional()
  @IsNumber()
  sstAmount?: number;

  @ApiPropertyOptional({ default: 'MYR' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ enum: ReceiptCategory })
  @IsEnum(ReceiptCategory)
  category: ReceiptCategory;

  @ApiProperty({
    description: 'Purchase datetime (ISO 8601)',
    example: '2026-05-16T17:30:00Z',
  })
  @IsISO8601()
  receiptDate: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  taxEligible?: boolean;

  @ApiPropertyOptional({ enum: LhdnRelief, default: LhdnRelief.NONE })
  @IsOptional()
  @IsEnum(LhdnRelief)
  lhdnRelief?: LhdnRelief;

  @ApiPropertyOptional({
    type: [String],
    example: ['#camping-trip', '#tax-2026'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [LineItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems?: LineItemDto[];

  @ApiPropertyOptional({
    description: 'Storage path returned by POST /receipts/capture',
  })
  @IsOptional()
  @IsString()
  imagePath?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'All section storage paths from POST /receipts/capture (long receipts)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imagePaths?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  confidence?: number;

  @ApiPropertyOptional({
    description: 'Raw OCR/model text, echoed from capture',
  })
  @IsOptional()
  @IsString()
  rawText?: string;
}
