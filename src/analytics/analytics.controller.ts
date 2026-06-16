import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  @ApiOperation({
    summary: 'Spending analytics',
    description:
      'Totals, monthly trend, category split, top merchants, weekday pattern and tax-eligible split over the chosen window.',
  })
  @ApiResponse({ status: 200, description: 'Analytics payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getAnalytics(@CurrentUser() user: User, @Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getAnalytics(
      user,
      query.range,
      query.dateFrom,
      query.dateTo,
    );
  }
}
