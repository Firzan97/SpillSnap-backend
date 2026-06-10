import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';
import { LeaderboardResponseDto } from './dto/leaderboard-response.dto';
import { LeaderboardService } from './leaderboard.service';

@ApiTags('leaderboard')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Receipt-upload leaderboard',
    description:
      'Ranks users by number of confirmed receipts uploaded in the selected period. Returns the top-3 podium, the ranked list, and where the current user stands ("N receipts to overtake X").',
  })
  @ApiOkResponse({
    description: 'Leaderboard payload',
    type: LeaderboardResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or expired token' })
  getLeaderboard(
    @CurrentUser() user: User,
    @Query() query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponseDto> {
    return this.leaderboardService.getLeaderboard(user, query);
  }
}
