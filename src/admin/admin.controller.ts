import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/guards/clerk-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
// ClerkAuthGuard resolves request.user; AdminGuard then enforces role=admin.
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('metrics')
  @ApiOperation({
    summary: 'Admin dashboard metrics',
    description:
      'Aggregate signups, subscription mix, receipts (app vs WhatsApp), AI token usage/cost, engagement, and revenue. Admin only.',
  })
  @ApiResponse({ status: 200, description: 'Metrics payload' })
  @ApiResponse({ status: 403, description: 'Not an admin' })
  metrics() {
    return this.adminService.metrics();
  }

  @Get('users')
  @ApiOperation({
    summary: 'Recent users',
    description: 'Most-recent registrations with resolved plan (pro/trial/free).',
  })
  @ApiResponse({ status: 200, description: 'User rows' })
  users(@Query('limit') limit?: string) {
    return this.adminService.recentUsers(limit ? Number(limit) : 50);
  }

  @Post('reset')
  @ApiOperation({
    summary: 'DESTRUCTIVE: wipe all non-admin users + data',
    description:
      'Deletes every non-admin user and their receipts/subscriptions/usage, and clears the AI-usage ledger. Admin accounts are kept. Requires body { "confirm": "RESET" }.',
  })
  @ApiResponse({ status: 200, description: 'Deletion summary' })
  @ApiResponse({ status: 400, description: 'Missing/invalid confirmation' })
  reset(@Body() body: { confirm?: string }) {
    if (body?.confirm !== 'RESET') {
      throw new BadRequestException(
        'Confirmation required: send { "confirm": "RESET" }.',
      );
    }
    return this.adminService.reset();
  }
}
