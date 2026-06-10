import { ApiProperty } from '@nestjs/swagger';
import { LeaderboardPeriod, LeaderboardScope } from './leaderboard-query.dto';

export class LeaderboardEntryDto {
  @ApiProperty({ example: 1, description: '1-based position in the ranking' })
  rank: number;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'Priya R.' })
  name: string;

  @ApiProperty({ example: 'PR', description: 'Avatar initials' })
  initials: string;

  @ApiProperty({ example: '#F472B6', description: 'Avatar background hex' })
  avatarColor: string;

  @ApiProperty({ nullable: true, type: String, example: null })
  avatarUrl: string | null;

  @ApiProperty({
    example: 187,
    description: 'Confirmed receipts in the period',
  })
  receiptCount: number;

  @ApiProperty({
    example: 12,
    description: 'Receipts uploaded in the last 7 days (the "↑ +N" badge)',
  })
  weeklyGain: number;

  @ApiProperty({ example: false })
  isCurrentUser: boolean;
}

export class OvertakeTargetDto {
  @ApiProperty({ example: 'Hafiz M.', description: 'User one rank above you' })
  name: string;

  @ApiProperty({ example: 22, description: 'Receipts you need to match them' })
  receiptsBehind: number;
}

export class CurrentUserStandingDto {
  @ApiProperty({
    nullable: true,
    type: Number,
    example: 3,
    description: 'Null if the user has no confirmed receipts in the period',
  })
  rank: number | null;

  @ApiProperty({ example: 142 })
  receiptCount: number;

  @ApiProperty({ example: 9 })
  weeklyGain: number;

  @ApiProperty({ nullable: true, type: OvertakeTargetDto })
  toOvertake: OvertakeTargetDto | null;
}

export class LeaderboardResponseDto {
  @ApiProperty({ enum: LeaderboardPeriod })
  period: LeaderboardPeriod;

  @ApiProperty({ enum: LeaderboardScope })
  scope: LeaderboardScope;

  @ApiProperty({ example: 8, description: 'Total ranked users in scope' })
  participants: number;

  @ApiProperty({
    type: [LeaderboardEntryDto],
    description: 'Top 3 - for the podium',
  })
  podium: LeaderboardEntryDto[];

  @ApiProperty({
    type: [LeaderboardEntryDto],
    description: 'Ranked list, capped at `limit`',
  })
  rankings: LeaderboardEntryDto[];

  @ApiProperty({ type: CurrentUserStandingDto })
  currentUser: CurrentUserStandingDto;
}
