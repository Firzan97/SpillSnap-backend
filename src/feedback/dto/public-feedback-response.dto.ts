import { ApiProperty } from '@nestjs/swagger';

export class FeedbackItemDto {
  @ApiProperty({
    example:
      '“The streak got me. I’m 47 days deep. My accountant said it’s the cleanest set of receipts she’s ever seen.”',
  })
  quote: string;

  @ApiProperty({ example: 'Hafiz M.' })
  name: string;

  @ApiProperty({ example: 'F&B owner · Penang' })
  role: string;

  @ApiProperty({ example: '#A78BFA', description: 'Hex avatar color' })
  avatarColor: string;

  @ApiProperty({ example: 'HM' })
  initials: string;

  @ApiProperty({ example: 5, description: 'Star rating 1-5' })
  rating: number;
}

export class PublicFeedbackResponseDto {
  @ApiProperty({
    type: [FeedbackItemDto],
    description: 'Approved testimonials, hand-ordered',
  })
  items: FeedbackItemDto[];

  @ApiProperty({
    example: 4.8,
    description:
      'Average star rating across ALL approved testimonials (not just the ones returned), rounded to 1 dp. 0 when there are none.',
  })
  averageRating: number;

  @ApiProperty({
    example: 128,
    description: 'Total number of approved testimonials behind the average.',
  })
  reviewCount: number;

  @ApiProperty({
    example: '2026-06-02T10:00:00.000Z',
    description:
      'When this snapshot was computed (server-cached, refreshes hourly)',
  })
  generatedAt: string;
}
