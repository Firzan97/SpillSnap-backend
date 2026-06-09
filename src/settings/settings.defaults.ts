import {
  NotificationPrefs,
  SecurityPrefs,
} from '../users/entities/user.entity';

/** Notification toggle groups — keys are stable; labels/subs power the UI. */
export const NOTIFICATION_GROUPS: {
  title: string;
  rows: { key: string; label: string; sub: string; default: boolean }[];
}[] = [
  {
    title: 'Receipts & streaks',
    rows: [
      {
        key: 'snap',
        label: 'Daily snap reminder',
        sub: "Nudge me at 8:00 PM if I haven't snapped",
        default: true,
      },
      {
        key: 'streak',
        label: 'Streak at risk',
        sub: 'Alert me before my streak resets at midnight',
        default: true,
      },
      {
        key: 'weekly',
        label: 'Weekly summary',
        sub: 'Sunday recap of spending & receipts',
        default: false,
      },
    ],
  },
  {
    title: 'Tax & LHDN',
    rows: [
      {
        key: 'efiling',
        label: 'e-Filing deadline',
        sub: 'Countdown alerts as 30 Apr approaches',
        default: true,
      },
      {
        key: 'relief',
        label: 'Relief cap nearing',
        sub: 'When a relief category hits 80% of its cap',
        default: true,
      },
    ],
  },
  {
    title: 'From SpillSnap',
    rows: [
      {
        key: 'product',
        label: 'Product updates',
        sub: 'New features & improvements',
        default: true,
      },
      {
        key: 'tips',
        label: 'Tips & offers',
        sub: 'Occasional ways to get more from Pro',
        default: false,
      },
    ],
  },
];

export function defaultNotificationPrefs(): NotificationPrefs {
  const prefs: Record<string, boolean> = {};
  for (const g of NOTIFICATION_GROUPS)
    for (const r of g.rows) prefs[r.key] = r.default;
  return {
    channels: { push: true, email: true },
    prefs,
    quietHours: { enabled: true, from: '10:00 PM', to: '7:00 AM' },
  };
}

export function defaultSecurityPrefs(): SecurityPrefs {
  return { faceIdUnlock: true };
}

/** Colour per category — mirrors the dashboard + frontend category metadata. */
export const CATEGORY_COLORS: Record<string, string> = {
  groceries: '#06B6D4',
  dining: '#22D3EE',
  transport: '#67E8F9',
  shopping: '#A5F3FC',
  sports: '#0E7490',
  bills: '#155E75',
  medical: '#10B981',
  books: '#6366F1',
  other: '#94A3B8',
};
