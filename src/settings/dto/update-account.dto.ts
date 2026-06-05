import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CURRENCIES } from '../../currency/currency.config';

const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export class UpdateAccountDto {
  @ApiPropertyOptional({ description: 'Full name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Malaysian phone (+60…)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Require Face ID to open the app' })
  @IsOptional()
  @IsBoolean()
  faceIdUnlock?: boolean;

  @ApiPropertyOptional({
    description: 'Base/display currency (ISO 4217)',
    example: 'MYR',
  })
  @IsOptional()
  @IsIn(CURRENCY_CODES)
  baseCurrency?: string;
}
