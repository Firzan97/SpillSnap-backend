import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { WhatsappService } from './whatsapp.service';

/**
 * Meta WhatsApp Cloud API webhook. Public (Meta calls it, not our app):
 *  - GET  verifies the subscription with hub.verify_token
 *  - POST receives inbound messages; body is HMAC-signed with the app secret
 *
 * Excluded from Swagger — it's an external integration endpoint.
 */
@ApiExcludeController()
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  // GET /api/v1/whatsapp/webhook — Meta verification handshake
  @Get('webhook')
  @Header('Content-Type', 'text/plain')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const result = this.whatsapp.verifyWebhook(mode, token, challenge);
    if (result === null) throw new ForbiddenException('Verification failed');
    return result;
  }

  // POST /api/v1/whatsapp/webhook — inbound messages
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): { received: true } {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    if (!this.whatsapp.verifySignature(req.rawBody, signature)) {
      throw new BadRequestException('Invalid signature');
    }
    // Ack fast (Meta retries on non-200); process without blocking the response.
    void this.whatsapp.handleWebhook(body);
    return { received: true };
  }
}
