import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class MergeTagsDto {
  @ApiProperty({
    type: [String],
    example: ['#tax', '#tax2026'],
    description:
      'Source tags to merge away (rewritten on every receipt that uses them)',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  from: string[];

  @ApiProperty({
    example: '#tax-2026',
    description: 'Canonical tag the sources merge into',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  into: string;
}
