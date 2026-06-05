/**
 * MANUAL (non-receipt) reliefs, versioned per Year of Assessment.
 *
 * SpendSnap derives most reliefs from snapped receipts (see relief-rules.config).
 * But several LHDN reliefs can never come from a receipt — they're read off an
 * annual statement (EPF, insurance, SSPN, housing-loan interest) or depend on
 * the taxpayer's status/dependents (disability, spouse, children). Those are
 * collected here as OPTIONAL user input on the Tax relief screen and folded into
 * the same claimable total.
 *
 * Field types:
 *  - 'amount' : user enters RM; claimable = min(value, cap).
 *  - 'toggle' : on/off; claimable = on ? amount : 0.
 *  - 'count'  : number of dependents; claimable = value * perUnit.
 */

export type ManualReliefType = 'amount' | 'toggle' | 'count';

export interface ManualReliefField {
  /** Stable id, used as the storage key + API key. */
  key: string;
  label: string;
  /** Short helper line shown under the field. */
  hint: string;
  /** Grouping for the UI: figures from statements vs status/dependents. */
  group: 'financial' | 'status';
  type: ManualReliefType;
  /** 'amount': max claimable RM. */
  cap?: number;
  /** 'toggle': fixed relief RM when on. */
  amount?: number;
  /** 'count': relief RM per dependent. */
  perUnit?: number;
}

// Sourced from hasil.gov.my (Individual → Tax Reliefs), YA2025. Re-verify each
// year when the Budget is confirmed — caps and categories change annually.
const YA2025_FIELDS: ManualReliefField[] = [
  // ── Group: figures from your annual statements ──────────────────────────────
  { key: 'epf', label: 'EPF / approved pension', hint: 'Mandatory or voluntary EPF contributions', group: 'financial', type: 'amount', cap: 4000 },
  { key: 'life_insurance', label: 'Life insurance / takaful', hint: 'Premiums or additional voluntary EPF', group: 'financial', type: 'amount', cap: 3000 },
  { key: 'prs', label: 'PRS & deferred annuity', hint: 'Private Retirement Scheme contributions', group: 'financial', type: 'amount', cap: 3000 },
  { key: 'edu_med_insurance', label: 'Education & medical insurance', hint: 'Premiums for self, spouse or child', group: 'financial', type: 'amount', cap: 4000 },
  { key: 'socso', label: 'SOCSO / PERKESO', hint: 'Your contribution for the year', group: 'financial', type: 'amount', cap: 350 },
  { key: 'sspn', label: 'SSPN net deposit', hint: 'Total deposits minus withdrawals this year', group: 'financial', type: 'amount', cap: 8000 },
  { key: 'housing_loan', label: 'Housing loan interest', hint: 'First home, S&P dated 2025 to 2027', group: 'financial', type: 'amount', cap: 7000 },

  // ── Group: your status & dependents ─────────────────────────────────────────
  { key: 'disabled_self', label: 'Disabled individual', hint: 'You are a registered OKU', group: 'status', type: 'toggle', amount: 7000 },
  { key: 'spouse', label: 'Spouse / alimony', hint: 'Spouse has no income, or you pay alimony', group: 'status', type: 'toggle', amount: 4000 },
  { key: 'disabled_spouse', label: 'Disabled spouse', hint: 'Your spouse is a registered OKU', group: 'status', type: 'toggle', amount: 6000 },
  { key: 'child_under18', label: 'Children under 18', hint: 'Unmarried, RM2,000 each', group: 'status', type: 'count', perUnit: 2000 },
  { key: 'child_tertiary', label: 'Children 18+ in higher education', hint: 'Diploma and above, RM8,000 each', group: 'status', type: 'count', perUnit: 8000 },
  { key: 'child_disabled', label: 'Disabled children', hint: 'Registered OKU, RM8,000 each', group: 'status', type: 'count', perUnit: 8000 },
];

const MANUAL_RELIEF_FIELDS_BY_YA: Record<number, ManualReliefField[]> = {
  2025: YA2025_FIELDS,
};

/** Manual relief field catalog for a YA, falling back to the latest defined set. */
export function manualReliefFieldsForYa(ya: number): ManualReliefField[] {
  return (
    MANUAL_RELIEF_FIELDS_BY_YA[ya] ??
    MANUAL_RELIEF_FIELDS_BY_YA[2025] ??
    []
  );
}

/** Claimable RM a stored value contributes for a given field. */
export function manualClaimable(field: ManualReliefField, value: number): number {
  const v = Number.isFinite(value) ? Math.max(value, 0) : 0;
  switch (field.type) {
    case 'amount':
      return Math.min(v, field.cap ?? v);
    case 'toggle':
      return v > 0 ? (field.amount ?? 0) : 0;
    case 'count':
      return v * (field.perUnit ?? 0);
  }
}
