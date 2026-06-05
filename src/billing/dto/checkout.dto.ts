import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { BillingInterval } from '../entities/subscription.entity';

export class CheckoutDto {
  @ApiProperty({
    enum: BillingInterval,
    description: 'Billing cadence for the Pro subscription.',
    example: BillingInterval.ANNUAL,
  })
  @IsEnum(BillingInterval)
  interval: BillingInterval;
}
