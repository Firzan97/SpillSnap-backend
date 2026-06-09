import { User } from '../users/entities/user.entity';

/**
 * Server-driven Settings config. The backend describes each Settings screen as
 * a list of typed rows; the mobile app renders them generically instead of
 * hardcoding. Rows can be gated by `phase` / feature `flag` and are stripped
 * here before the screen is sent, so the client only ever sees active rows.
 *
 * See the shared cross-team plan ("spendsnap-settings-config").
 */

// ── Public row schema (what the client receives) ─────────────────────────────
export type SettingsRow =
  | {
      id: string;
      type: 'value';
      label: string;
      value: string | null;
      sub?: string;
    }
  | {
      id: string;
      type: 'input';
      label: string;
      field: string;
      value: string | null;
      sub?: string;
    }
  | {
      id: string;
      type: 'toggle';
      label: string;
      key: string;
      value: boolean;
      sub?: string;
    }
  | {
      id: string;
      type: 'navigation';
      label: string;
      target: string;
      sub?: string;
      value?: string;
    }
  | {
      id: string;
      type: 'action';
      label: string;
      action: string;
      tone?: 'default' | 'primary' | 'danger';
      sub?: string;
    }
  | { id: string; type: 'link'; label: string; url: string; sub?: string };

export interface SettingsSection {
  title?: string;
  rows: SettingsRow[];
}

export interface SettingsScreen {
  title: string;
  sections: SettingsSection[];
}

// ── Gating ───────────────────────────────────────────────────────────────────
/**
 * Feature flags for rows that exist in the design but are not part of Phase 1.
 * Flip a flag to true (or bump ACTIVE_PHASE) to surface a row — no app release.
 */
export const SETTINGS_FLAGS = {
  twoFactor: false,
  deviceList: false,
  autoTagRules: false,
  socialNotif: false,
  lhdnRow: false,
} as const;

export type SettingsFlag = keyof typeof SETTINGS_FLAGS;

export const ACTIVE_PHASE = 1;

/** Client platform — drives platform-specific rows (e.g. Face ID is iOS-only). */
export type Platform = 'ios' | 'android' | 'web';

/**
 * A manifest row is a public row plus optional backend-only gating metadata.
 * `platforms` whitelists which clients see the row; a row with `platforms` set
 * is hidden unless the request's platform is listed (and unknown ⇒ hidden), so
 * an unsupported feature never leaks onto the wrong client.
 */
type Gated = { phase?: 1 | 2; flag?: SettingsFlag; platforms?: Platform[] };
type ManifestRow = SettingsRow & Gated;
interface ManifestSection {
  title?: string;
  rows: ManifestRow[];
}

function isActive(row: Gated, platform?: Platform): boolean {
  if (row.phase && row.phase > ACTIVE_PHASE) return false;
  if (row.flag && !SETTINGS_FLAGS[row.flag]) return false;
  if (row.platforms && (!platform || !row.platforms.includes(platform)))
    return false;
  return true;
}

/** Drop gated-out rows, strip backend-only fields, and remove empty sections. */
function resolve(
  sections: ManifestSection[],
  platform?: Platform,
): SettingsSection[] {
  return sections
    .map((s) => ({
      title: s.title,
      rows: s.rows
        .filter((r) => isActive(r, platform))
        .map(({ phase: _p, flag: _f, platforms: _pl, ...row }) => row),
    }))
    .filter((s) => s.rows.length > 0);
}

// ── Static external destinations ─────────────────────────────────────────────
const SUPPORT_EMAIL = 'support@spillsnap.com';
const SITE = 'https://spillsnap.com';

// ── Screen builders ──────────────────────────────────────────────────────────

/** Settings index — the menu shown on the Profile screen. */
export function buildSettingsIndex(platform?: Platform): SettingsScreen {
  const sections: ManifestSection[] = [
    {
      rows: [
        {
          id: 'account',
          type: 'navigation',
          label: 'Account & security',
          target: 'settings-account',
          sub: 'Profile, Face ID, password',
        },
        {
          id: 'categories',
          type: 'navigation',
          label: 'Categories',
          target: 'settings-categories',
          sub: 'Spending breakdown',
        },
        {
          id: 'notifications',
          type: 'navigation',
          label: 'Notifications',
          target: 'settings-notifications',
          sub: 'Reminders & alerts',
        },
        {
          id: 'export',
          type: 'navigation',
          label: 'Export data',
          target: 'settings-export',
          sub: 'CSV for LHDN e-Filing',
        },
        // Phase 2 — appears when the lhdnRow flag is enabled.
        {
          id: 'lhdn',
          type: 'navigation',
          label: 'LHDN profile',
          target: 'settings-lhdn',
          sub: 'Tax identity & reliefs',
          flag: 'lhdnRow',
        },
        {
          id: 'help',
          type: 'navigation',
          label: 'Help & support',
          target: 'settings-help',
          sub: 'FAQ, contact, legal',
        },
      ],
    },
    {
      rows: [
        {
          id: 'sign-out',
          type: 'action',
          label: 'Sign out',
          action: 'signOut',
          tone: 'default',
        },
        {
          id: 'delete-account',
          type: 'action',
          label: 'Delete account',
          action: 'deleteAccount',
          tone: 'danger',
          phase: 2,
        },
      ],
    },
  ];
  return { title: 'Settings', sections: resolve(sections, platform) };
}

/** Account & security screen — identity + security controls. */
export function buildAccountScreen(
  user: User,
  faceIdUnlock: boolean,
  platform?: Platform,
): SettingsScreen {
  const sections: ManifestSection[] = [
    {
      title: 'Profile',
      rows: [
        {
          id: 'name',
          type: 'input',
          label: 'Name',
          field: 'name',
          value: user.name,
        },
        {
          id: 'phone',
          type: 'input',
          label: 'Phone',
          field: 'phone',
          value: user.phone ?? null,
          sub: 'For account recovery',
        },
        {
          id: 'email',
          type: 'value',
          label: 'Email',
          value: user.email,
          sub: 'Verified',
        },
      ],
    },
    {
      title: 'Security',
      rows: [
        // Face ID is iOS-only for now — hidden on Android/Web.
        {
          id: 'face-id',
          type: 'toggle',
          label: 'Face ID unlock',
          key: 'faceIdUnlock',
          value: faceIdUnlock,
          sub: 'Require Face ID to open the app',
          platforms: ['ios'],
        },
        {
          id: 'change-password',
          type: 'action',
          label: 'Change password',
          action: 'changePassword',
          tone: 'default',
        },
        // Phase 2
        {
          id: 'two-factor',
          type: 'toggle',
          label: 'Two-factor authentication',
          key: 'twoFactor',
          value: false,
          sub: 'Extra login step',
          flag: 'twoFactor',
        },
        {
          id: 'devices',
          type: 'navigation',
          label: 'Active devices',
          target: 'settings-devices',
          flag: 'deviceList',
        },
      ],
    },
  ];
  return { title: 'Account & security', sections: resolve(sections, platform) };
}

/** Help & support screen — static links + app meta. */
export function buildHelpScreen(appVersion: string): SettingsScreen {
  const sections: ManifestSection[] = [
    {
      title: 'Get help',
      rows: [
        { id: 'faq', type: 'link', label: 'FAQ', url: `${SITE}/faq` },
        {
          id: 'guide',
          type: 'link',
          label: 'LHDN e-Filing guide',
          url: `${SITE}/lhdn-guide`,
        },
        {
          id: 'contact',
          type: 'link',
          label: 'Contact support',
          url: `mailto:${SUPPORT_EMAIL}`,
          sub: SUPPORT_EMAIL,
        },
      ],
    },
    {
      title: 'Legal',
      rows: [
        {
          id: 'privacy',
          type: 'link',
          label: 'Privacy policy',
          url: `${SITE}/privacy`,
        },
        {
          id: 'terms',
          type: 'link',
          label: 'Terms of service',
          url: `${SITE}/terms`,
        },
        { id: 'pdpa', type: 'link', label: 'PDPA notice', url: `${SITE}/pdpa` },
      ],
    },
    {
      title: 'About',
      rows: [
        {
          id: 'version',
          type: 'value',
          label: 'App version',
          value: appVersion,
        },
      ],
    },
  ];
  return { title: 'Help & support', sections: resolve(sections) };
}
