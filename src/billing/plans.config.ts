import { BillingInterval, PlanId } from './entities/subscription.entity';

/**
 * Feature flags an entitlement can grant. The Free (post-trial) tier gets the
 * basics; Pro (and anyone in-trial) gets everything.
 */
export interface PlanFeatures {
  unlimitedScans: boolean;
  lhdnTagging: boolean;
  multiCurrency: boolean;
  cloudArchive: boolean;
  leaderboard: boolean;
}

export const FREE_FEATURES: PlanFeatures = {
  unlimitedScans: false,
  lhdnTagging: false,
  multiCurrency: false,
  cloudArchive: false,
  leaderboard: true, // viewing the leaderboard stays free
};

export const PRO_FEATURES: PlanFeatures = {
  unlimitedScans: true,
  lhdnTagging: true,
  multiCurrency: true,
  cloudArchive: true,
  leaderboard: true,
};

/** Post-trial Free tier: 1 receipt upload per day. */
export const FREE_DAILY_UPLOAD_LIMIT = 1;

/** Length of the no-card free trial granted at signup. */
export const TRIAL_DAYS = 7;

/**
 * Public plan catalog that drives the Pricing page. Prices are SST-inclusive
 * (8%) and quoted in MYR. The numbers come from the design; the Stripe price
 * IDs are read from env so they can differ per environment.
 */
export interface PricingPlan {
  id: PlanId;
  name: string;
  tagline: string;
  prices: {
    interval: BillingInterval;
    amount: number; // gross, SST-inclusive
    perMonth: number; // effective monthly
    currency: 'MYR';
    stripePriceEnv: string; // env var holding the Stripe price id
    savingsPct?: number;
  }[];
  features: string[];
  notIncluded?: string[];
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: PlanId.FREE,
    name: 'Free',
    tagline: 'Forever · for occasional snappers',
    prices: [
      {
        interval: BillingInterval.MONTHLY,
        amount: 0,
        perMonth: 0,
        currency: 'MYR',
        stripePriceEnv: '',
      },
    ],
    features: [
      '1 receipt upload per day',
      'Auto-OCR & categorisation',
      'Manual tags + CSV export',
    ],
    notIncluded: ['LHDN tax tagging', 'Unlimited scans'],
  },
  {
    id: PlanId.PRO,
    name: 'Pro',
    tagline: 'For everyday snappers who file tax',
    prices: [
      {
        interval: BillingInterval.MONTHLY,
        amount: 12.0,
        perMonth: 12.0,
        currency: 'MYR',
        stripePriceEnv: 'STRIPE_PRICE_PRO_MONTHLY',
      },
      {
        interval: BillingInterval.ANNUAL,
        amount: 118.8,
        perMonth: 9.9,
        currency: 'MYR',
        stripePriceEnv: 'STRIPE_PRICE_PRO_ANNUAL',
        // RM9.90/mo vs RM12.00/mo = 17.5% off → rounded for display.
        savingsPct: 18,
      },
    ],
    features: [
      'Unlimited scans · iOS + Android',
      'LHDN tax tagging + e-Filing export',
      'Streaks, leaderboards & bookmarks',
      'Multi-currency (RM, SGD, USD)',
      'WhatsApp receipt capture',
      '7-year encrypted cloud archive',
    ],
  },
];

export const PRICING_NOTES = {
  currency: 'MYR',
  sstIncludedPct: 8,
  trialDays: TRIAL_DAYS,
  note: 'Prices in MYR · Includes 8% SST · First 7 days free · Cancel anytime',
};
