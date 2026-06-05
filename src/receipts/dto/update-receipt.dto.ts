import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateReceiptDto } from './create-receipt.dto';

/** All create fields optional, plus the bookmark toggle. */
export class UpdateReceiptDto extends PartialType(CreateReceiptDto) {
  @ApiPropertyOptional({ description: 'Toggle bookmark' })
  @IsOptional()
  @IsBoolean()
  bookmarked?: boolean;
}
