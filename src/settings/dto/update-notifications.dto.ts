import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class ChannelsDto {
  @IsOptional() @IsBoolean() push?: boolean;
  @IsOptional() @IsBoolean() email?: boolean;
}

class QuietHoursDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class UpdateNotificationsDto {
  @ApiPropertyOptional({ description: 'Channel toggles (push/email)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelsDto)
  channels?: ChannelsDto;

  @ApiPropertyOptional({
    description: 'Per-key toggle map, e.g. { snap: true, weekly: false }',
  })
  @IsOptional()
  @IsObject()
  prefs?: Record<string, boolean>;

  @ApiPropertyOptional({ description: 'Quiet hours config' })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto;
}
