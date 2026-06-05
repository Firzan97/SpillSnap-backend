import {
  LhdnRelief,
  ReceiptCategory,
} from '../receipts/entities/receipt.entity';

/**
 * LHDN personal-relief rules, versioned per Year of Assessment (YA).
 *
 * Core principle: receipts store FACTS (category, amount, date). This file
 * holds POLICY (which reliefs exist, and their caps) for each YA. Relief is
 * computed at read-time by matching a receipt's YA (from its date) to the rules
 * here — so when LHDN changes a cap or drops/adds a category, we edit only this
 * file and the whole history recomputes. No receipt data ever migrates.
 *
 * Each October, when the Budget is tabled, add the next YA entry as 'confirmed'.
 */

/**
 * A relief "bucket" = one shared RM cap. Most buckets hold a single relief
 * category, but some are shared: LHDN claims books/journals WITHIN the RM2,500
 * Lifestyle cap, so the lifestyle bucket lists both LIFESTYLE and BOOKS as
 * members. Spending across all members of a bucket is summed against the one
 * `cap` — so books + computers can't together exceed RM2,500.
 */
export interface ReliefBucket {
  /** Stable bucket id (used as the grouping key in the summary API). */
  key: string;
  /** Shared RM cap for everything in this bucket, for this YA. */
  cap: number;
  /** Human-readable label for the UI. */
  label: string;
  /** LHDN section reference, shown as a hint. */
  section: string;
  /** Relief categories whose spending draws from this shared cap. */
  members: LhdnRelief[];
}

export interface YaRules {
  ya: number;
  /**
   * 'confirmed' = official LHDN figures for this YA.
   * 'provisional' = inherited from the latest confirmed YA because this year's
   * Budget hasn't been announced yet. UI must label it "estimated".
   */
  status: 'confirmed' | 'provisional';
  buckets: ReliefBucket[];
}

// Figures sourced from hasil.gov.my (Individual → Tax Reliefs), YA2025. Re-verify
// each year against the official page when that YA's Budget is confirmed —
// caps and categories change annually. Only receipt-claimable reliefs are
// modelled here (status-based reliefs like the RM9,000 personal relief, EPF,
// PRS and housing-loan interest aren't driven by receipts, so they're out of
// scope for SpendSnap).
export const RELIEF_RULES: Record<number, YaRules> = {
  2025: {
    ya: 2025,
    status: 'confirmed',
    buckets: [
      // Shared RM2,500 cap: lifestyle + books/journals (LHDN folds books in here).
      {
        key: 'lifestyle',
        cap: 2500,
        label: 'Lifestyle',
        section: 'S46(1)(p)',
        members: [LhdnRelief.LIFESTYLE, LhdnRelief.BOOKS],
      },
      // Separate ADDITIONAL relief on top of lifestyle.
      {
        key: 'sports',
        cap: 1000,
        label: 'Sports equipment & activity',
        section: 'S46(1)(p) sports',
        members: [LhdnRelief.SPORTS],
      },
      // Restricted RM10,000; has internal sub-limits (vaccination/dental/full
      // exam capped at RM1,000 each within this total — not modelled yet).
      {
        key: 'medical',
        cap: 10000,
        label: 'Medical (serious diseases)',
        section: 'S46(1)(d)',
        members: [LhdnRelief.MEDICAL],
      },
      {
        key: 'ev_charging',
        cap: 2500,
        label: 'EV charging facilities',
        section: 'S46(1)(p) EV',
        members: [LhdnRelief.EV_CHARGING],
      },
      {
        key: 'breastfeeding',
        cap: 1000,
        label: 'Breastfeeding equipment',
        section: 'S46(1)(q)',
        members: [LhdnRelief.BREASTFEEDING],
      },
      {
        key: 'childcare',
        cap: 3000,
        label: 'Childcare centre / kindergarten',
        section: 'S46(1)(o)',
        members: [LhdnRelief.CHILDCARE],
      },
      {
        key: 'education',
        cap: 7000,
        label: 'Education fees (self)',
        section: 'S46(1)(f)',
        members: [LhdnRelief.EDUCATION],
      },
    ],
  },
};

/**
 * Step 1 of relief back-fill: the FREE, no-AI mapping. A receipt's spending
 * category (set automatically by OCR on every receipt) maps straight to a
 * relief category for the obvious cases. Anything not here is ambiguous and
 * falls through to the AI classifier (Step 2).
 */
export const CATEGORY_TO_RELIEF: Partial<Record<ReceiptCategory, LhdnRelief>> =
  {
    [ReceiptCategory.MEDICAL]: LhdnRelief.MEDICAL,
    [ReceiptCategory.BOOKS]: LhdnRelief.BOOKS,
    [ReceiptCategory.SPORTS]: LhdnRelief.SPORTS,
  };

/**
 * Rules for a YA. If that year isn't in the table yet (Budget not announced),
 * inherit the latest confirmed year's rules and flag the result 'provisional'
 * so the UI shows an "estimated · pending LHDN" badge.
 */
export function rulesForYa(ya: number): YaRules {
  const exact = RELIEF_RULES[ya];
  if (exact) return exact;

  const confirmedYears = Object.values(RELIEF_RULES)
    .filter((r) => r.status === 'confirmed')
    .map((r) => r.ya)
    .sort((a, b) => b - a);

  const baseYear = confirmedYears.find((y) => y <= ya) ?? confirmedYears[0];
  const base = baseYear != null ? RELIEF_RULES[baseYear] : undefined;

  return { ya, status: 'provisional', buckets: base?.buckets ?? [] };
}

/**
 * Which bucket a receipt's relief tag draws from. Returns undefined for NONE or
 * any tag not claimable in this YA (e.g. a category LHDN dropped) — the caller
 * treats that as "not claimable", keeping the receipt but counting RM0.
 */
export function bucketForRelief(
  rules: YaRules,
  relief: LhdnRelief,
): ReliefBucket | undefined {
  if (relief === LhdnRelief.NONE) return undefined;
  return rules.buckets.find((b) => b.members.includes(relief));
}

export type FilingMode = 'filing' | 'tracking';

export interface FilingPeriod {
  /** The YA this period is centred on. */
  ya: number;
  /**
   * 'filing'   = Jan–Apr: the prior YA's return is being filed now.
   * 'tracking' = May–Dec: accumulating toward the current (in-progress) YA.
   */
  mode: FilingMode;
  /** e-Filing deadline (Apr 30) as YYYY-MM-DD. */
  deadline: string;
}

/** Read a Date's year/month in Malaysia time (assessment years are MY-local). */
function malaysiaYearMonth(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

/**
 * Single source of truth for "which YA + deadline are we on right now", so the
 * assessment year and the deadline can never contradict (the old dashboard
 * computed them separately and drifted apart after every Apr 30).
 *
 * - Jan 1 – Apr 30 of year Y: filing YA (Y-1), deadline Apr 30 of Y.
 * - May 1 – Dec 31 of year Y: tracking YA (Y),  deadline Apr 30 of Y+1.
 */
export function resolveFilingPeriod(now: Date = new Date()): FilingPeriod {
  const { year, month } = malaysiaYearMonth(now);
  const beforeMay = month <= 4; // Jan–Apr = filing window for last year
  if (beforeMay) {
    return { ya: year - 1, mode: 'filing', deadline: `${year}-04-30` };
  }
  return { ya: year, mode: 'tracking', deadline: `${year + 1}-04-30` };
}
