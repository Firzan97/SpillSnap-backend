import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { BillingInterval } from '../entities/subscription.entity';

export enum CheckoutPlatform {
  WEB = 'web',
  IOS = 'ios',
  ANDROID = 'android',
}

export class CheckoutDto {
  @ApiProperty({
    enum: BillingInterval,
    description: 'Billing cadence for the Pro subscription.',
    example: BillingInterval.ANNUAL,
  })
  @IsEnum(BillingInterval)
  interval: BillingInterval;

  @ApiPropertyOptional({
    enum: CheckoutPlatform,
    description:
      'Where checkout was started. Mobile platforms get a success page that ' +
      'deep-links back into the app; web stays on the website. Defaults to web.',
  })
  @IsOptional()
  @IsEnum(CheckoutPlatform)
  platform?: CheckoutPlatform;
}
