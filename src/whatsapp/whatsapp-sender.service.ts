import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Pure outbound + media access for the WhatsApp Cloud API. Holds no app/domain
 * dependencies (only ConfigService) so any module can use it without creating a
 * circular import (e.g. BillingService sends the Pro-welcome template).
 *
 * Inert until WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN are configured.
 */
@Injectable()
export class WhatsappSenderService {
  private readonly logger = new Logger(WhatsappSenderService.name);

  constructor(private readonly config: ConfigService) {}

  private get token() {
    return this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
  }
  private get phoneNumberId() {
    return this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
  }
  private get apiVersion() {
    return this.config.get<string>('WHATSAPP_API_VERSION') ?? 'v21.0';
  }
  private get graphBase() {
    return `https://graph.facebook.com/${this.apiVersion}`;
  }
  get enabled(): boolean {
    return !!this.token && !!this.phoneNumberId;
  }

  /** Free-form text - only deliverable inside an open 24h customer-service window. */
  async sendText(to: string, body: string): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body, preview_url: false },
    });
  }

  /**
   * Send an approved message template (the only way to message a user cold,
   * outside the 24h window). `bodyParams` fill {{1}}, {{2}}… in order.
   */
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    bodyParams: string[] = [],
  ): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: bodyParams.length
          ? [
              {
                type: 'body',
                parameters: bodyParams.map((text) => ({ type: 'text', text })),
              },
            ]
          : [],
      },
    });
  }

  async downloadMedia(
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimetype: string } | null> {
    if (!this.enabled) return null;
    try {
      const metaRes = await fetch(`${this.graphBase}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!metaRes.ok) return null;
      const meta = (await metaRes.json()) as {
        url?: string;
        mime_type?: string;
      };
      if (!meta.url) return null;
      const binRes = await fetch(meta.url, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!binRes.ok) return null;
      const buffer = Buffer.from(await binRes.arrayBuffer());
      return { buffer, mimetype: meta.mime_type ?? 'image/jpeg' };
    } catch (e) {
      this.logger.warn(`downloadMedia error: ${(e as Error).message}`);
      return null;
    }
  }

  private async post(payload: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;
    try {
      const res = await fetch(
        `${this.graphBase}/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        this.logger.warn(`send ${res.status}: ${await res.text()}`);
      }
    } catch (e) {
      this.logger.warn(`send error: ${(e as Error).message}`);
    }
  }
}
