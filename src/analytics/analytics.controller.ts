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
import { EntitlementService } from '../billing/entitlement.service';
import { assertPro } from '../billing/require-pro';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly entitlements: EntitlementService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Spending analytics (Pro)',
    description:
      'Totals, monthly trend, category split, top merchants, weekday pattern and tax-eligible split over the chosen window. Pro only — Free users get the home dashboard instead.',
  })
  @ApiResponse({ status: 200, description: 'Analytics payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 402, description: 'Pro feature — upgrade required' })
  async getAnalytics(
    @CurrentUser() user: User,
    @Query() query: AnalyticsQueryDto,
  ) {
    const ent = await this.entitlements.resolve(user);
    assertPro(ent, 'Advanced analytics');
    return this.analyticsService.getAnalytics(
      user,
      query.range,
      query.dateFrom,
      query.dateTo,
    );
  }
}
