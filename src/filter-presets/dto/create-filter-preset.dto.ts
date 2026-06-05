import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateFilterPresetDto {
  @ApiProperty({
    example: 'Groceries 2025',
    description: 'Display name for the saved filter',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name: string;

  @ApiProperty({ example: '2025', default: 'All time' })
  @IsString()
  @IsOptional()
  year?: string;

  @ApiProperty({
    type: [String],
    example: ['groceries', 'dining'],
    default: [],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  categories?: string[];

  @ApiProperty({ type: [String], example: ['#tax'], default: [] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiProperty({ example: false, default: false })
  @IsBoolean()
  @IsOptional()
  bookmarked?: boolean;
}
