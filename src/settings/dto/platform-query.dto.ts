import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { Platform } from '../settings.config';

/**
 * Optional client platform. Drives platform-specific rows — e.g. the Face ID
 * toggle is iOS-only, so Android/Web clients must send their platform (or omit
 * it) to correctly have that row hidden.
 */
export class PlatformQueryDto {
  @ApiPropertyOptional({
    enum: ['ios', 'android', 'web'],
    description: 'Client platform; iOS-only rows (e.g. Face ID) are hidden otherwise',
  })
  @IsOptional()
  @IsIn(['ios', 'android', 'web'])
  platform?: Platform;
}
