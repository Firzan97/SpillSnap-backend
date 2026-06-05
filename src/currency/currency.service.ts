import { Injectable, Logger } from '@nestjs/common';

interface RateCache {
  rates: Record<string, number>; // units of X per 1 base
  fetchedAt: number;
}

const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface Conversion {
  /** Amount expressed in the base currency. */
  baseAmount: number;
  /** Multiplier applied: baseAmount = amount * fxRate. */
  fxRate: number;
}

/**
 * Live currency conversion using a free, no-key FX API (open.er-api.com, daily
 * ECB-derived rates). Rates are cached per base currency for a few hours. If a
 * lookup fails the amount is returned unchanged (fxRate 1) so a receipt is never
 * lost to a network hiccup.
 */
@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private readonly cache = new Map<string, RateCache>();

  private async getRates(base: string): Promise<Record<string, number> | null> {
    const key = base.toUpperCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.rates;

    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${key}`);
      const body = (await res.json()) as {
        result?: string;
        rates?: Record<string, number>;
      };
      if (body.result !== 'success' || !body.rates) {
        this.logger.warn(`FX fetch for ${key} returned no rates`);
        return hit?.rates ?? null;
      }
      this.cache.set(key, { rates: body.rates, fetchedAt: Date.now() });
      return body.rates;
    } catch (err) {
      this.logger.warn(`FX fetch failed for ${key}: ${(err as Error).message}`);
      return hit?.rates ?? null; // serve stale on failure if we have it
    }
  }

  /**
   * Convert `amount` from `from` currency into `base`. Returns the base amount
   * (rounded to 2dp) plus the multiplier used. Same currency → rate 1.
   */
  async convert(amount: number, from: string, base: string): Promise<Conversion> {
    const f = (from || base).toUpperCase();
    const b = base.toUpperCase();
    if (!Number.isFinite(amount)) return { baseAmount: 0, fxRate: 1 };
    if (f === b) return { baseAmount: round2(amount), fxRate: 1 };

    const rates = await this.getRates(b);
    const perBase = rates?.[f]; // units of `from` per 1 base
    if (!perBase || perBase <= 0) {
      this.logger.warn(`No rate ${f}->${b}; storing amount unconverted`);
      return { baseAmount: round2(amount), fxRate: 1 };
    }
    const fxRate = 1 / perBase; // base per 1 unit of `from`
    return { baseAmount: round2(amount * fxRate), fxRate };
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
