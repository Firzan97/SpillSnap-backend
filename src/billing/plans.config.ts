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

/**
 * Plan limits. These are the CODE DEFAULTS; the live values are admin-editable
 * via app_config under LIMITS_CONFIG_KEY, so they can change without an app
 * release. Read them through AppConfigService.get(LIMITS_CONFIG_KEY, DEFAULT_LIMITS).
 */
export const LIMITS_CONFIG_KEY = 'limits';

export interface AppLimits {
  /** Free tier: receipts per calendar month. */
  freeMonthlyScans: number;
  /** Length (days) of the free trial granted on Pro checkout (0 = none). */
  trialDays: number;
}

export const DEFAULT_LIMITS: AppLimits = {
  freeMonthlyScans: 15,
  trialDays: 5,
};

/** @deprecated use AppLimits.freeMonthlyScans (kept for any static reference). */
export const FREE_MONTHLY_UPLOAD_LIMIT = DEFAULT_LIMITS.freeMonthlyScans;

/** @deprecated use AppLimits.trialDays. */
export const TRIAL_DAYS = DEFAULT_LIMITS.trialDays;

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
      '15 receipt scans per month',
      'Auto-OCR & categorisation',
      'Streaks & leaderboards',
      'Manual tags & notes',
    ],
    notIncluded: [
      'Unlimited scans',
      'CSV data export',
      'Saved filters & filtered export',
      'LHDN tax tagging',
    ],
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
      'Export your data to CSV',
      'LHDN tax tagging + e-Filing export',
      'Saved filters & filtered export',
      'Multi-currency (RM, SGD, USD)',
      'WhatsApp receipt capture',
      '7-year encrypted cloud archive',
    ],
  },
];

export const PRICING_NOTES = {
  currency: 'MYR',
  sstIncludedPct: 8,
  // Trial is granted on Pro CHECKOUT (card required), not at signup. Once per
  // user. Admin-editable via the pricing config; 0 disables the trial.
  trialDays: TRIAL_DAYS,
  note: `Prices in MYR · Includes 8% SST · First ${TRIAL_DAYS} days free · Cancel anytime`,
};

// ── Dynamic (admin-editable) pricing ─────────────────────────────────────────
/** app_config key under which an admin-edited pricing payload is stored. */
export const PRICING_CONFIG_KEY = 'pricing';

/** Full payload shape served by GET /pricing/plans (and edited in admin). */
export interface PricingPayload {
  plans: PricingPlan[];
  currency: string;
  sstIncludedPct: number;
  trialDays: number;
  note: string;
}

/** The code default — what's served when no admin override exists. */
export function pricingDefault(): PricingPayload {
  return { plans: PRICING_PLANS, ...PRICING_NOTES };
}
