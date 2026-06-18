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
  async sendText(to: string, body: string): Promise<boolean> {
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body, preview_url: false },
    });
  }

  /**
   * Send an approved message template (the only way to message a user cold,
   * outside the 24h window). `bodyParams` fill the body variables.
   *
   * Pass a string[] for positional templates ({{1}}, {{2}}…) or a
   * Record<name,value> for named templates ({{customer_name}}…); Meta needs
   * `parameter_name` on each param for the named form. Returns true only if
   * Meta accepted the message.
   */
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    bodyParams: string[] | Record<string, string> = [],
  ): Promise<boolean> {
    const parameters = Array.isArray(bodyParams)
      ? bodyParams.map((text) => ({ type: 'text', text }))
      : Object.entries(bodyParams).map(([name, text]) => ({
          type: 'text',
          parameter_name: name,
          text,
        }));
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: parameters.length ? [{ type: 'body', parameters }] : [],
      },
    });
  }

  /**
   * One-time onboarding/welcome template, resolved from config so every caller
   * (signup, Pro upgrade, phone-edit) stays in sync. Returns true only on a real
   * Meta-accepted send so callers can persist a "greeted" flag without marking
   * users who never actually got the message.
   *
   * `hello_world` is Meta's universal sample template — it has NO body variable
   * and only exists in `en_US`. Special-case it so a dev can smoke-test delivery
   * before a branded template is approved; any other template gets the configured
   * language plus the user's first name in the named {{customer_name}} variable.
   */
  async sendWelcome(to: string, firstName: string): Promise<boolean> {
    const template = this.config
      .get<string>('WHATSAPP_WELCOME_TEMPLATE')
      ?.trim();
    if (!template) return false;
    if (template === 'hello_world') {
      return this.sendTemplate(to, 'hello_world', 'en_US', []);
    }
    const lang =
      this.config.get<string>('WHATSAPP_TEMPLATE_LANG')?.trim() || 'en';
    return this.sendTemplate(to, template, lang, { customer_name: firstName });
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

  /** Returns true only when Meta accepted the message (HTTP 2xx). */
  private async post(payload: Record<string, unknown>): Promise<boolean> {
    if (!this.enabled) return false;
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
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`send error: ${(e as Error).message}`);
      return false;
    }
  }
}
