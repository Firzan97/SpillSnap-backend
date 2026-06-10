import { ApiProperty } from '@nestjs/swagger';

export class BackfillSummaryDto {
  @ApiProperty({ example: 42, description: 'Untagged receipts examined' })
  scanned: number;

  @ApiProperty({
    example: 18,
    description: 'Tagged by the free category→relief map (no AI)',
  })
  autoMapped: number;

  @ApiProperty({
    example: 9,
    description: 'Tagged by the AI classifier (confident)',
  })
  aiTagged: number;

  @ApiProperty({
    example: 5,
    description:
      'AI suggested a relief but was unsure - left untagged for the user to confirm',
  })
  needsReview: number;

  @ApiProperty({ example: 10, description: 'Genuinely not claimable' })
  stillNone: number;
}
