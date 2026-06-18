import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AppLimits, PricingPayload } from '../billing/plans.config';
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
    description:
      'Most-recent registrations with resolved plan (pro/trial/free).',
  })
  @ApiResponse({ status: 200, description: 'User rows' })
  users(@Query('limit') limit?: string) {
    return this.adminService.usersPage(limit ? Number(limit) : 50);
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

  // ── Pricing (admin-editable) ────────────────────────────────────────────────
  @Get('pricing')
  @ApiOperation({ summary: 'Get effective pricing + default + override flag' })
  getPricing() {
    return this.adminService.getPricing();
  }

  @Put('pricing')
  @ApiOperation({ summary: 'Save an admin-edited pricing payload' })
  @ApiResponse({ status: 200, description: 'Saved pricing' })
  @ApiResponse({ status: 400, description: 'Invalid pricing payload' })
  async setPricing(@Body() payload: PricingPayload) {
    try {
      return await this.adminService.setPricing(payload);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Post('pricing/reset')
  @ApiOperation({ summary: 'Revert pricing to the shipped default' })
  resetPricing() {
    return this.adminService.resetPricing();
  }

  // ── Plan limits (admin-editable) ────────────────────────────────────────────
  @Get('limits')
  @ApiOperation({
    summary: 'Get effective plan limits + default + override flag',
  })
  getLimits() {
    return this.adminService.getLimits();
  }

  @Put('limits')
  @ApiOperation({
    summary: 'Save admin-edited plan limits (free monthly scans, trial days)',
  })
  @ApiResponse({ status: 200, description: 'Saved limits' })
  @ApiResponse({ status: 400, description: 'Invalid limits payload' })
  async setLimits(@Body() payload: AppLimits) {
    try {
      return await this.adminService.setLimits(payload);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  @Post('limits/reset')
  @ApiOperation({ summary: 'Revert plan limits to the shipped default' })
  resetLimits() {
    return this.adminService.resetLimits();
  }
}
