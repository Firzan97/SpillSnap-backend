import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { User } from '../users/entities/user.entity';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Home dashboard',
    description:
      'Returns greeting, spending summary, highlights, categories, recent receipts, and e-filing status for the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'Dashboard payload' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - missing or expired token',
  })
  getDashboard(@CurrentUser() user: User) {
    return this.dashboardService.getDashboard(user);
  }
}
