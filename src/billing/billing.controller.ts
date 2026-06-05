import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { BillingService } from './billing.service';
import { CheckoutDto } from './dto/checkout.dto';
import { EntitlementService } from './entitlement.service';
import { PRICING_NOTES, PRICING_PLANS } from './plans.config';

@ApiTags('pricing')
@Controller('pricing')
export class PricingController {
  @Get('plans')
  @ApiOperation({
    summary: 'Public plan catalog',
    description:
      'Free + Pro plans with MYR (SST-inclusive) prices and feature lists. Drives the Pricing page.',
  })
  @ApiResponse({ status: 200, description: 'Plan catalog' })
  getPlans() {
    return { plans: PRICING_PLANS, ...PRICING_NOTES };
  }
}

@ApiTags('subscription')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('subscription')
export class SubscriptionController {
  constructor(
    private readonly billing: BillingService,
    private readonly entitlements: EntitlementService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Current entitlement',
    description:
      'Resolves the user’s plan, status, trial countdown, daily-upload limit, and feature flags. Drives the trial ribbon and "Current plan" badge.',
  })
  @ApiResponse({ status: 200, description: 'Entitlement' })
  getMine(@CurrentUser() user: User) {
    return this.entitlements.resolve(user);
  }

  @Post('checkout')
  @ApiOperation({
    summary: 'Start Pro checkout (Stripe)',
    description:
      'Creates a Stripe Checkout session and returns its URL. The card is collected now but not charged until the free trial ends.',
  })
  @ApiResponse({ status: 201, description: 'Checkout URL' })
  checkout(@CurrentUser() user: User, @Body() dto: CheckoutDto) {
    return this.billing.createCheckout(user, dto);
  }

  @Post('portal')
  @ApiOperation({
    summary: 'Open the Stripe Customer Portal',
    description:
      'Returns a URL where the user can update their card or cancel. Cancellation flows back via webhook.',
  })
  @ApiResponse({ status: 201, description: 'Portal URL' })
  portal(@CurrentUser() user: User) {
    return this.billing.createPortal(user);
  }
}

@ApiTags('webhooks')
@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post('stripe')
  @HttpCode(200)
  @ApiExcludeEndpoint() // signed by Stripe, not a client-facing API
  async stripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const raw = this.billing.assertRawBody(req.rawBody);
    await this.billing.handleWebhook(raw, signature);
    return { received: true };
  }
}
