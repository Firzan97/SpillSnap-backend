import { ApiProperty } from '@nestjs/swagger';

export class ReliefBucketSummaryDto {
  @ApiProperty({ example: 'lifestyle', description: 'Stable bucket id' })
  key: string;

  @ApiProperty({ example: 'Lifestyle' })
  label: string;

  @ApiProperty({ example: 'S46(1)(p)', description: 'LHDN section reference' })
  section: string;

  @ApiProperty({
    example: 2500,
    description: 'RM cap for this bucket in this YA',
  })
  cap: number;

  @ApiProperty({
    example: 1840.5,
    description: 'Total spent toward this bucket',
  })
  spent: number;

  @ApiProperty({
    example: 1840.5,
    description: 'Claimable = min(spent, cap) — what actually counts as relief',
  })
  claimable: number;

  @ApiProperty({
    example: 659.5,
    description: 'Cap headroom left (cap − claimable)',
  })
  remaining: number;

  @ApiProperty({
    example: 74,
    description: 'Claimable as % of cap (drives the "cap nearing" alert)',
  })
  pct: number;

  @ApiProperty({
    example: 12,
    description: 'Receipts contributing to this bucket',
  })
  receiptCount: number;
}

export class ManualReliefItemDto {
  @ApiProperty({ example: 'epf', description: 'Stable field id' })
  key: string;

  @ApiProperty({ example: 'EPF / approved pension' })
  label: string;

  @ApiProperty({ example: 'Mandatory or voluntary EPF contributions' })
  hint: string;

  @ApiProperty({ example: 'financial', enum: ['financial', 'status'] })
  group: 'financial' | 'status';

  @ApiProperty({ example: 'amount', enum: ['amount', 'toggle', 'count'] })
  type: 'amount' | 'toggle' | 'count';

  @ApiProperty({
    example: 4000,
    nullable: true,
    description: "'amount' max claimable",
  })
  cap: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: "'toggle' fixed relief RM",
  })
  amount: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description: "'count' relief RM per dependent",
  })
  perUnit: number | null;

  @ApiProperty({
    example: 4000,
    description: 'Stored raw value (RM, 0/1, or count)',
  })
  value: number;

  @ApiProperty({
    example: 4000,
    description: 'Claimable RM this field contributes',
  })
  claimable: number;
}

export class ReliefSummaryResponseDto {
  @ApiProperty({
    example: 2025,
    description: 'Year of Assessment this summary covers',
  })
  ya: number;

  @ApiProperty({
    example: 'confirmed',
    enum: ['confirmed', 'provisional'],
    description:
      "'provisional' when the YA's reliefs aren't finalised yet (figures inherited from the latest confirmed year).",
  })
  status: 'confirmed' | 'provisional';

  @ApiProperty({
    example: 'tracking',
    enum: ['filing', 'tracking'],
    description:
      "'filing' = the prior YA's return is open now (Jan–Apr); 'tracking' = accumulating toward the in-progress YA (May–Dec).",
  })
  mode: 'filing' | 'tracking';

  @ApiProperty({
    example: '2026-04-30',
    description: 'e-Filing deadline for this YA (Apr 30 of YA+1)',
  })
  deadline: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'User-facing caveat, set only when status is provisional.',
  })
  disclaimer: string | null;

  @ApiProperty({ type: [ReliefBucketSummaryDto] })
  buckets: ReliefBucketSummaryDto[];

  @ApiProperty({
    type: [ManualReliefItemDto],
    description:
      'Optional non-receipt reliefs the user can fill in (EPF, insurance, dependents, etc.).',
  })
  manualReliefs: ManualReliefItemDto[];

  @ApiProperty({
    example: 7000,
    description: 'Sum of claimable from manual reliefs',
  })
  manualClaimable: number;

  @ApiProperty({
    example: 19340.5,
    description: 'Sum of claimable across receipt buckets AND manual reliefs',
  })
  totalClaimable: number;
}
