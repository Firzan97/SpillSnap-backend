import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdateManualReliefsDto {
  @ApiProperty({
    description:
      'Map of manual relief field key → raw numeric value (RM for amounts, 0/1 for toggles, a count for dependents). Only known keys are stored; unknown keys are ignored.',
    example: { epf: 4000, life_insurance: 1500, child_under18: 2 },
  })
  @IsObject()
  values: Record<string, number>;
}
