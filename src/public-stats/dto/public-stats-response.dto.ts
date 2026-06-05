import { ApiProperty } from '@nestjs/swagger';

export class StatCounterDto {
  @ApiProperty({ example: 2410000, description: 'Raw current value' })
  value: number;

  @ApiProperty({
    example: 18400,
    description: 'Recent gain over the stat\'s natural window (today / week / month)',
  })
  delta: number;
}

export class TopSnapperDto {
  @ApiProperty({ example: 1 })
  rank: number;

  @ApiProperty({ example: 'Priya R.', description: 'Anonymized display handle' })
  name: string;

  @ApiProperty({ example: 'PR' })
  initials: string;

  @ApiProperty({ example: '#F472B6' })
  avatarColor: string;

  @ApiProperty({ example: 187, description: 'Confirmed receipts this month' })
  receiptCount: number;
}

export class PublicStatsResponseDto {
  @ApiProperty({ type: StatCounterDto })
  receiptsUploaded: StatCounterDto;

  @ApiProperty({ type: StatCounterDto })
  activeMembers: StatCounterDto;

  @ApiProperty({ type: StatCounterDto })
  freeUsers: StatCounterDto;

  @ApiProperty({ type: StatCounterDto })
  proSubscribers: StatCounterDto;

  @ApiProperty({
    type: StatCounterDto,
    description: 'SST captured on tax-eligible receipts (RM), used as the public "tax savings" proxy',
  })
  taxSavings: StatCounterDto;

  @ApiProperty({ type: [TopSnapperDto], description: 'Anonymized top snappers this month' })
  topSnappers: TopSnapperDto[];

  @ApiProperty({
    example: '2026-06-01T10:00:00.000Z',
    description: 'When this snapshot was computed (server-cached, refreshes hourly)',
  })
  generatedAt: string;
}
