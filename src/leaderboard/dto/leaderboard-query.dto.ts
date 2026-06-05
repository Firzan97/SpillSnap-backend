import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum LeaderboardPeriod {
  WEEK = 'week',
  MONTH = 'month',
  ALL = 'all',
}

export enum LeaderboardScope {
  FRIENDS = 'friends',
  GLOBAL = 'global',
  MALAYSIA = 'malaysia',
}

export class LeaderboardQueryDto {
  @ApiPropertyOptional({
    enum: LeaderboardPeriod,
    default: LeaderboardPeriod.MONTH,
    description: 'Time window used to count uploaded receipts.',
  })
  @IsOptional()
  @IsEnum(LeaderboardPeriod)
  period: LeaderboardPeriod = LeaderboardPeriod.MONTH;

  @ApiPropertyOptional({
    enum: LeaderboardScope,
    default: LeaderboardScope.GLOBAL,
    description:
      'Audience to rank against. "friends" and "malaysia" fall back to global until a friend graph / country column exists.',
  })
  @IsOptional()
  @IsEnum(LeaderboardScope)
  scope: LeaderboardScope = LeaderboardScope.GLOBAL;

  @ApiPropertyOptional({
    default: 50,
    minimum: 3,
    maximum: 200,
    description: 'Max ranked rows to return (podium aside).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(200)
  limit: number = 50;
}
